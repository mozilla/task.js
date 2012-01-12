// FIXME: https://github.com/mozilla/task.js/issues/17

/* task.js v{{version}} taskjs.org | taskjs.org/license */
(function(global) {

// local name for this module
var exports;

var hasPrevious = "task" in global;
var previous = global.task;

function uninstall() {
    if (hasPrevious)
        global.task = previous;
    else
        delete global.task;
    return exports;
}

function enqueue_setTimeout() {
    function enqueue(thunk) {
        global.setTimeout(thunk, 0);
    }
    return enqueue;
}

function enqueue_nextTick() {
    function enqueue(thunk) {
        global.process.nextTick(thunk);
    }
    return enqueue;
}

// http://ajaxian.com/archives/settimeout-delay
function enqueue_postMessage() {
    var timeouts = [];
    var messageName = "zero-timeout-message";

    function enqueue(thunk) {
        timeouts.push(thunk);
        global.postMessage(messageName, "*");
    }

    global.addEventListener("message", function(event) {
        if (event.source === global && event.data === messageName) {
            event.stopPropagation();
            if (timeouts.length > 0) {
                var thunk = timeouts.shift();
                thunk();
            }
        }
    }, true);

    return enqueue;
}

// FIXME: https://github.com/mozilla/task.js/issues/17

// {{#browser}}
// var enqueue = (typeof global.postMessage === "function")
//             ? enqueue_postMessage()
//             : enqueue_setTimeout();
// {{/browser}}

// {{#node}}
// var enqueue = enqueue_nextTick();
// {{/node}}


// Inspired by:
// https://github.com/kriszyp/node-promise/blob/master/promise.js

// Differences:
// - does not flatten promises on `then`
// - currently no enforcement of throwing
// - uses task.js's `enqueue`
// - null out deferred's waiting queue

function Promise() {
    if (!(this instanceof Promise))
        return new Promise();
}

Promise.prototype = {
    get: function(key) {
        return this.then(function(obj) {
            return obj[key];
        });
    },
    put: function(key, val) {
        return this.then(function(obj) {
            return obj[key] = val;
        });
    },
    call: function(key) {
        return this.then(function(obj) {
            return obj[key].apply(obj, Array.prototype.slice.call(arguments, 1));
        });
    },
    addCallback: function(callback) {
        return this.then(callback);
    },
    addErrback: function(errback) {
        return this.then(function(){}, errback);
    },
    addBoth: function(callback) {
        return this.then(callback, callback);
    },
    addCallbacks: function(callback, errback) {
        return this.then(callback, errback);
    },
    timeout: function(delay, compensate) {
        return choose(this, sleep(delay, compensate).then(function() {
            throw new Error("timeout (" + delay + ")") 
        }));
    }
};

const P_UNRESOLVED = 0;
const P_RESOLVED = 1;
const P_REJECTED = 2;
const P_CANCELLED = 3;

function Deferred(cancel) {
    if (!(this instanceof Deferred))
        return new Deferred(cancel);

    // FIXME: could do the "nobody ever saw this error, throw it somewhere!" that node-promise does
    var result, state = P_UNRESOLVED, waiting = [];
    var promise = this.promise = new Promise();

    function notifyAll(value, rejected) {
        switch (state) {
          case P_CANCELLED:
            return;
          case P_UNRESOLVED:
            break;
          default:
            throw new TypeError("deferred is already resolved (state is " + state + ")");
        }
        state = rejected ? P_REJECTED : P_RESOLVED;
        result = value;
        for (var i = 0, n = waiting.length; i < n; i++)
            notify(waiting[i]);
        waiting = null;
    }

    function notify(listener) {
        var func = state === P_REJECTED ? listener.onError : listener.onResolve;
        if (func) {
            exports.enqueue(function() {
                try {
                    listener.next.resolve(func(result));
                } catch (e) {
                    listener.next.reject(e);
                }
            });
        } else if (state === P_REJECTED) {
            listener.next.reject(result);
        } else {
            listener.next.resolve(result);
        }
    }

    this.resolve = this.callback = this.emitSuccess = function(value) {
        notifyAll(value, false);
    };

    var reject = this.reject = this.errback = this.emitError = function(error) {
        notifyAll(error, true);
    };

    this.progress = function(update) {
        for (var i = 0, n = waiting.length; i < n; i++) {
            var progress = waiting[i].progress;
            progress && progress(update);
        }
    };

    this.then = promise.then = function(onResolve, onError, onProgress) {
        var next = new Deferred(cancel);
        var listener = {
            onResolve: onResolve,
            onError: onError,
            onProgress: onProgress,
            next: next
        };
        if (state !== P_UNRESOLVED)
            notify(listener);
        else
            waiting.push(listener);
        return next.promise;
    };

    this.cancel = promise.cancel = function() {
        this.state = P_CANCELLED;
        this.waiting = null;
        cancel();
    };
}

Deferred.prototype = Promise.prototype;

function now(value) {
    var deferred = new Deferred(function(){});
    deferred.resolve(value);
    return deferred.promise;
}

function never() {
    return (new Deferred(function(){})).promise;
}

function join() {
    var promises = arguments, n = promises.length;

    // resolve immediately
    if (n === 0)
        return now([]);

    var state = P_UNRESOLVED, result = new Array(n), pending = new Array(n), remaining = n;
    var cancel = function() {
        if (state !== P_UNRESOLVED)
            return;
        remaining = 0;
        state = P_CANCELLED;
        for (var i = 0; i < n; i++) {
            var p = pending[i];
            if (p)
                p.cancel();
        }
        pending = null;
    };
    var deferred = new Deferred(cancel);
    // FIXME: what do we do about the dropped results and (worse) errors here?
    //        or can we prove that the tests (and pending array) are unnecessary
    //        based on invariants of promises?
    for (var i = 0; i < n; i++) {
        (function(i) {
            var p = promises[i];
            pending[i] = p;
            p.then(function(value) {
                if (state !== P_UNRESOLVED || !pending[i])
                    return;
                result[i] = value;
                if ((--remaining) === 0) {
                    state = P_RESOLVED;
                    pending = null;
                    deferred.resolve(result);
                } else {
                    pending[i] = null;
                }
            }, function(e) {
                if (state !== P_UNRESOLVED || !pending[i])
                    return;
                error = e;
                remaining = 0;
                state = P_REJECTED;
                for (var j = 0; j < n; j++) {
                    if (j === i || !pending[j])
                        continue;
                    pending[j].cancel();
                }
                pending = null;
                deferred.reject(e);
            });
        })(i);
    }
    return deferred.promise;
}

function choose() {
    var promises = arguments, n = promises.length;
    var state = P_UNRESOLVED, result;
    var cancel = function() {
        if (state !== P_UNRESOLVED)
            return;
        for (var i = 0; i < n; i++)
            promises[i].cancel();
    }
    var deferred = new Deferred(cancel);
    for (var i = 0; i < n; i++) {
        (function(i) {
            promises[i].then(function(value) {
                if (state !== P_UNRESOLVED)
                    return;
                result = value;
                state = P_RESOLVED;
                for (var j = 0; j < n; j++) {
                    if (j !== i)
                        promises[j].cancel();
                }
                deferred.resolve(value);
            }, function(e) {
                if (state !== P_UNRESOLVED)
                    return;
                result = e;
                state = P_REJECTED;
                for (var j = 0; j < n; j++) {
                    if (j !== i)
                        promises[j].cancel();
                }
                deferred.reject(e);
            });
        })(i);
    }
    return deferred.promise;
}

const T_PAUSED    = 0;  // can't be scheduled or executed
const T_STARTED   = 1;  // may or may not currently be executing
const T_CANCELLED = 2;  // cancelled but not yet done cleaning up
const T_CLOSED    = 3;  // completely done

const R_BLOCKED   = 0;  // waiting on a promise
const R_RESOLVED  = 1;  // ready to resume with a resolved value
const R_REJECTED  = 2;  // ready to resume with a rejected value
const R_RUNNING   = 3;  // currently executing

var counter = 0;
function nextTID() {
    var result = counter;
    counter = (counter + 1) & 0xffffffff;
    return result;
}

function Task(thunk) {
    if (!(this instanceof Task))
        return new Task(thunk);
    this.tid = nextTID();                // thread ID
    this.result = void 0;                // intermediate or final result
    this.runState = R_RESOLVED;          // execution status within scheduler
    this.threadState = T_PAUSED;         // state in thread's lifecycle
    this.thread = thunk.call(this);      // thread
    this.scheduler = currentScheduler(); // scheduler
    this.deferred = new Deferred();
    this.then = this.deferred.then;
}

var Tp = Task.prototype = new Promise();

Tp.isStarted = function() {
    return this.threadState === T_STARTED;
};

Tp.isRunning = function() {
    return this.runState === R_RUNNING;
};

Tp.start = function() {
    if (this.threadState !== T_PAUSED)
        throw new Error("task is already started or completed");
    this.threadState = T_STARTED;
    if (this.runState !== R_BLOCKED) {
        this.scheduler.schedule(this);
        pump(this.scheduler);
    }
    return this;
};

Tp.pause = function() {
    if (this.runState === R_RUNNING)
        throw new Error("tasks can only be paused while blocked");
    this.threadState = T_PAUSED;
    this.scheduler.unschedule(this);
    return this;
};

Tp.cancel = function() {
    if (this.runState === R_RUNNING)
        throw new Error("tasks can only be cancelled while blocked");
    this.threadState = T_CANCELLED;
    this.scheduler.schedule(this);
    pump(this.scheduler);
    return this;
};

Tp.toString = function() {
    return "[object Task " + this.tid + "]";
};

const READY = now();

function runScheduledTask(task) {
    var result = task.result, send = (task.runState === R_RESOLVED);
    try {
        task.runState = R_RUNNING;
        task.result = void 0;
        if (task.threadState === T_CANCELLED) {
            task.thread.close();
            task.result = void 0;
            task.runState = R_RESOLVED;
            task.threadState = T_CLOSED;
        } else {
            var p = (send ? task.thread.send(result) : task.thread["throw"](result)) || READY;
            task.runState = R_BLOCKED;
            p.then(function(value) {
                task.result = value;
                task.runState = R_RESOLVED;
                if (task.threadState === T_STARTED) {
                    task.scheduler.schedule(task);
                    pump(task.scheduler);
                }
            }, function(e) {
                task.result = e;
                task.runState = R_REJECTED;
                if (task.threadState === T_STARTED) {
                    task.scheduler.schedule(task);
                    pump(task.scheduler);
                }
            });
        }
    } catch (e) {
        task.threadState = T_CLOSED;
        if (e instanceof TaskResult || e instanceof StopIteration) {
            task.result = e.value;
            task.runState = R_RESOLVED;
            task.deferred.resolve(e.value);
        } else {
            task.result = e;
            task.runState = R_REJECTED;
            task.deferred.reject(e);
        }
    }
}

var runningTask = null;

Task.current = function() {
    return runningTask;
}

function pump(scheduler) {
    if (runningTask)
        return;
    var task = scheduler.choose();
    if (!task)
        return;
    exports.enqueue(function() {
        runningTask = task;
        runScheduledTask(task);
        runningTask = null;
        pump(scheduler);
    });
}

function spawn(thunk) {
    return (new Task(thunk)).start();
}

function currentStack() {
    try {
        throw new Error();
    } catch (e) {
        return e.stack.split(/\n/).slice(1).map(function (line) {
            var match1 = line.match(/^[a-zA-Z0-9_]*/);
            var match2 = line.match(/[^\/]+:[0-9]+$/);
            return (match1 && match2) ? (match1[0] + "@" + match2[0]) : line;
        });
    }
}

function sourceOf(x) {
    return (x && typeof x === "object") ? x.toSource() : String(x);
}

function RandomScheduler() {
    this.ready = []; // unblocked tasks ready to resume
}

RandomScheduler.prototype = {
    choose: function() {
        var n = this.ready.length;
        if (n === 0)
            return null;
        if (n === 1) {
            var r = this.ready[0];
            this.ready = []
            return r;
        }
        var i = Math.floor(Math.random() * n);
        return this.ready.splice(i, 1)[0];
    },
    schedule: function(task) {
        this.ready.push(task);
    },
    unschedule: function(task) {
        var ready = this.ready;
        for (var i = 0, n = ready.length; i < n; i++) {
            if (ready[i] === task) {
                ready.splice(i, 1);
                return;
            }
        }
    }
};

var scheduler = new RandomScheduler();

function currentScheduler() {
    return scheduler;
}

function setCurrentScheduler(s) {
    scheduler = s;
}

function TaskResult(value) {
    if (!(this instanceof TaskResult))
        return new TaskResult(value);
    this.value = value;
}

TaskResult.prototype = {
    toString: function() {
        return "[TaskResult " + this.value + "]";
    }
};

function sleep(delay, compensate) {
    var start = Date.now();
    var deferred = new Deferred();
    var id = global.setTimeout(resolveOrTryAgain, delay);

    function resolveOrTryAgain() {
        var end = Date.now();
        var actual = end - start;
        if (compensate && actual < delay) {
            id = global.setTimeout(resolveOrTryAgain, delay - actual);
            return;
        }
        deferred.resolve(actual);
    }

    return deferred.promise;
}

// FIXME: https://github.com/mozilla/task.js/issues/17

/*
{{#template}}

{{declareExports}}

{{#export}}Deferred{{/export}}
{{#export}}enqueue{{/export}}
{{#export}}Task{{/export}}
{{#export}}TaskResult{{/export}}
{{#export}}join{{/export}}
{{#export}}choose{{/export}}
{{#export}}now{{/export}}
{{#export}}never{{/export}}
{{#export}}spawn{{/export}}
{{#export}}sleep{{/export}}
{{#export}}currentScheduler{{/export}}
{{#export}}setCurrentScheduler{{/export}}
{{#export}}RandomScheduler{{/export}}

{{/template}}
*/

global.task = exports = {
    uninstall: uninstall,
    Deferred: Deferred,
    enqueue: enqueue_setTimeout(),
    Task: Task,
    TaskResult: TaskResult,
    join: join,
    choose: choose,
    now: now,
    never: never,
    spawn: spawn,
    sleep: sleep,
    currentScheduler: currentScheduler,
    setCurrentScheduler: setCurrentScheduler,
    RandomScheduler: RandomScheduler
};

})(this);
