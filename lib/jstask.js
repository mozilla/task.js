/* ***** BEGIN LICENSE BLOCK *****
 *
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Narcissus JavaScript engine.
 *
 * The Initial Developer of the Original Code is
 * Brendan Eich <brendan@mozilla.org>.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Dave Herman <dherman@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

// TODO:
//  - enforce that fulfill does nothing if a task has been killed
//  - join should use cycle (i.e., deadlock) detection
//  - optionally have exceptions *not* kill join-peers but rather detach them
//    from the blocked task
//  - better PRNG for task scheduler and choice evt
//  - object-detect for WeakMap instead of ObjectMap (or do we need strong Map?)
//  - see if we can avoid object-valued maps altogether
//  - make Task/Evt internals closure-private?
//  - make sure we're nulling out all important properties when a task dies
//  - create a deterministic scheduler for testing
//  - test suite
//  - API docs
//  - more DOM evt abstractions

(function(global) {

var hasPrevious = "jsTask" in global;
var previous = global.jsTask;

function uninstall() {
    var jsTask = global.jsTask;
    if (hasPrevious)
        global.jsTask = previous;
    else
        delete global.jsTask;
    return jsTask;
}

var isGenerator = Function.isGenerator || function() { return true };

// an object-key table with poor asymptotics
function ObjectMap(array) {
    this.array = array || [];
}

function searchMap(map, key, found, notFound) {
    var a = map.array;
    for (var i = 0, n = a.length; i < n; i++) {
        var pair = a[i];
        if (pair.key === key)
            return found(pair, i);
    }
    return notFound();
}

ObjectMap.prototype = {
    has: function(x) {
        return searchMap(this, x, function() { return true }, function() { return false });
    },
    set: function(x, v) {
        var a = this.array;
        searchMap(this, x,
                  function(pair) { pair.value = v },
                  function() { a.push({ key: x, value: v }) });
    },
    get: function(x) {
        return searchMap(this, x,
                         function(pair) { return pair.value },
                         function() { return null });
    },
    getDef: function(x, thunk) {
        var a = this.array;
        return searchMap(this, x,
                         function(pair) { return pair.value },
                         function() {
                             var v = thunk();
                             a.push({ key: x, value: v });
                             return v;
                         });
    },
    forEach: function(f) {
        var a = this.array;
        for (var i = 0, n = a.length; i < n; i++) {
            var pair = a[i];
            f.call(this, pair.key, pair.value);
        }
    },
    choose: function() {
        return this.array[0].key;
    },
    get size() {
        return this.array.length;
    },
    remove: function(x) {
        var a = this.array;
        return searchMap(this, x,
                         function(pair, i) { return a.splice(i, 1)[0] },
                         function() { });
    },
    copy: function() {
        return new ObjectMap(this.array.map(function(pair) {
            return { key: pair.key, value: pair.value }
        }));
    },
    clear: function() {
        this.array = [];
    },
    toString: function() { return "[object ObjectMap]" }
};

// type Signal = { value: any, throw: boolean }
// type Target = { notify: function(Evt, Signal) -> void }

function Evt(methods) {
    for (var key in methods) {
        if (key !== "waiting")
            this[key] = methods[key];
    }
    // waiting :: ObjectMap(Target, true)
    this.waiting = new ObjectMap();
    // readyState :: Signal | false | null
    this.readyState = null;
}

Evt.from = function(x) {
    while (!(x instanceof Evt)) {
        if (typeof x !== "object" || x === null || typeof x.toEvt !== "function")
            return null;
        x = x.toEvt();
    }
    return x;
};

Evt.prototype = {
    // cancel :: () -> void [never throws]
    cancel: function() { },

    // complete :: () -> void [never throws]
    complete: function() { },

    // isReady :: () -> boolean
    isReady: function() { return !!this.readyState },

    // abort :: () -> void [never throws]
    abort: function() {
        this.readyState = false;
        this.cancel();
    },

    // fulfill :: (any[, boolean=false]) -> void [never throws]
    fulfill: function(x, exception) {
        if (this.readyState === null) {
            this.readyState = { value: x, throw: !!exception };
            this.complete();
            this.notifyAll();
        }
    },

    // notifyAll :: () -> void [never throws]
    // PRE: this.isReady()
    notifyAll: function() {
        var evt = this;
        this.waiting.forEach(function(target) {
            target.notify(evt);
        });
    },

    // block :: (Target) -> void
    block: function(target) {
        this.waiting.set(target, true);
    },

    // unblock :: (Target) -> void
    unblock: function(target) {
        this.waiting.remove(target);
        if (!this.waiting.size && this.readyState === null)
            this.abort();
    },

    // or :: (evt, ...) -> Evt
    or: function() {
        var evts = [this];
        for (var i = 0, n = arguments.length; i < n; i++)
            evts.push(arguments[i]);
        return new ChoiceEvt(evts);
    },

    // and :: (evt, ...) -> Evt
    and: function() {
        var evts = [this];
        for (var i = 0, n = arguments.length; i < n; i++)
            evts.push(arguments[i]);
        return new JoinEvt(evts);
    },

    "with": function(onsuccess, onfailure) {
        return new GuardEvt(this, onsuccess, onfailure);
    },

    guard: function(onsuccess, onfailure) {
        return new GuardEvt(this, onsuccess, onfailure);
    }
};

function TaskEvt(task) {
    this.task = task;
}

TaskEvt.prototype = new Evt({
    cancel: function() {
        this.task.stop();
    },
});

function JoinEvt(evts) {
    this.evts = evts;
    var pendingEvts = new ObjectMap();
    var self = this;
    evts.forEach(function(evt, i) {
        evt.block(self);
        pendingEvts.set(evt, i);
    });
    this.pendingEvts = pendingEvts;
}

JoinEvt.prototype = new Evt({
    cancel: function() {
        this.evts.forEach(function(evt) {
            evt.abort();
        });
    },
    complete: function() {
        if (this.readyState.throw) {
            this.evts.forEach(function(evt) {
                if (!evt.isReady())
                    evt.abort();
            });
        }
    },
    notify: function(evt) {
        if (typeof(this.pendingEvts.remove(evt)) !== "undefined" && evt.readyState.throw)
            this.fulfill(evt.readyState.value, true);
        else if (!this.pendingEvts.size)
            this.fulfill(this.evts.map(function(evt) { return evt.readyState.value }));
    }
});

function ChoiceEvt(evts) {
    this.evts = evts;
    var self = this;
    evts.forEach(function(evt) {
        evt.block(self);
    });
}

// FIXME: variations that prefer exceptions or that prefer non-exceptions?
ChoiceEvt.prototype = new Evt({
    cancel: function() {
        this.evts.forEach(function(evt) {
            evt.abort();
        });
    },
    complete: function() {
        var ready = [], notReady = [];
        this.evts.forEach(function(evt) {
            if (evt.isReady())
                ready.push(evt);
            else
                notReady.push(evt);
        });
        notReady.forEach(function(evt) {
            evt.abort();
        });
        // FIXME: use a better PRNG
        var i = Math.floor(Math.random() * ready.length);
        this.readyState = ready[i].readyState;
    },
    // FIXME: we may ignore this evt's result in complete, so is there a
    //        more efficient interface for fulfill? or should we just pass
    //        zero arguments since it's gonna ignore them anyway?
    notify: function(evt) {
        this.fulfill(evt.readyState.value, evt.readyState.throw);
    }
});

function GuardEvt(evt, onsuccess, onfailure) {
    evt.block(this);
    this.evt = evt;
    this.onsuccess = onsuccess;
    this.onfailure = onfailure;
}

GuardEvt.prototype = new Evt({
    cancel: function() {
        this.evt.abort();
    },
    complete: function() {
        var readyState = this.evt.readyState;
        if (readyState.throw) {
            var guard = this.onfailure;
            try {
                var value = guard ? guard(readyState.value) : readyState.value;
                this.readyState = { value: value, throw: true };
            } catch (e) {
                this.readyState = { value: e, throw: true };
            }
        } else {
            var guard = this.onsuccess;
            try {
                var value = guard(readyState.value);
                this.readyState = { value: value, throw: false };
            } catch (e) {
                this.readyState = { value: e, throw: true };
            }
        }
    },
    notify: function(evt) {
        this.fulfill(evt.readyState.value, evt.readyState.throw);
    }
});

function join() {
    var evts = [];
    for (var i = 0, n = arguments.length; i < n; i++)
        evts.push(arguments[i]);
    return new JoinEvt(evts);
}

function choose() {
    var evts = [];
    for (var i = 0, n = arguments.length; i < n; i++)
        evts.push(arguments[i]);
    return new ChoiceEvt(evts);
}

Evt.ALWAYS = new Evt();
Evt.ALWAYS.readyState = { value: true, throw: false };

Evt.NEVER = new Evt();

const NEWBORN = 0,   // not yet started
      ACTIVE  = 1,   // active (may or may not currently be executing)
      PAUSED  = 2,   // paused
      ABORTED = 3,   // aborted but not yet done cleaning up
      CLOSED  = 4    // completely done

var counter = 0;
function nextTID() {
    var result = counter;
    counter = (counter + 1) & 0xffff;
    return result;
}

// type Controller = function() -> void [never throws]

// newborn :: Controller
function newborn() {
    this.controlState = ACTIVE;
    this.controller = active;
    return this.controller();
}

// active :: Controller
function active() {
    var thread = this.thread;
    try {
        if (!this.isBlocked()) {
            var pending = this.pending;
            this.pending = null;
            this.running = true;
            current = this;
            var evt = Evt.from(!pending
                               ? thread.next()
                               : pending.throw
                               ? thread.throw(pending.value)
                               : thread.send(pending.value));
            if (evt) {
                evt.block(this);
                this.blockedOn = evt;
            }
            current = null;
            this.running = false;
        }
        schedule(this);
    } catch (e) {
        var now = Date.now();
        if (e === StopIteration) {
            this.taskEvt.fulfill(now);
        } else {
            this.uncaught = { value: e };
            this.taskEvt.fulfill(e, true);
        }
        shutdown(this);
    }
}

// aborted :: Controller
function aborted() {
    //console.log("aborting " + this);
    try {
        this.running = true;
        current = this;
        thread.close();
    } catch (e) {
        if (e !== StopIteration)
            this.uncaught = { value: e };
    }
    this.running = false;
    this.controlState = CLOSED;
    this.taskEvt.fulfill(Date.now());
    shutdown(this);
}

// shutdown :: (Task) -> void [never throws]
function shutdown(task) {
    current = null;
    task.running = false;
    task.controlState = CLOSED;
    task.thread = null;
    task.controller = null;
    task.blockedOn = null;
}

// FIXME: runState ::= DORMANT | SCHEDULED | RUNNING

function Task(thunk) {
    if (!isGenerator(thunk))
        throw new TypeError("expected generator function, got " + thunk);
    this.tid = nextTID();
    this.uncaught = null;
    this.pending = null;
    this.running = false;
    this.scheduled = false;
    this.cancelHandlers = [];
    this.blockedOn = null;
    this.thread = thunk.call(this);
    this.controlState = NEWBORN;
    this.controller = newborn;
    this.taskEvt = new TaskEvt(this);
}

function spawn(thunk) {
    var task = new Task(thunk);
    task.start();
    return task;
}

var current = null;

Task.current = function() {
    return current;
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

function isReady(task) {
    for (var i = 0, j = readyTasks.length; i < j; i++) {
        if (readyTasks[i] === task)
            return true;
    }
    return false;
}

var readyTasks = [];

// no task is currently executing
var idle = true;

//global.trace = [];

function chooseTask() {
    // FIXME: use a better PRNG
    var i = Math.floor(Math.random() * readyTasks.length);
    //global.trace.push({ index: i, tid: readyTasks[i].tid });
    return i;
}

function schedule(task) {
    if (task && !task.scheduled) {
        switch (task.controlState) {
          case ACTIVE:
            if (task.blockedOn)
                break;
            // FALL THROUGH
          case ABORTED:
            task.scheduled = true;
            readyTasks.push(task);
        }
    }
    if (idle && readyTasks.length) {
        idle = false;
        var stack = currentStack();
        setTimeout(function() {
            var nextTask = readyTasks.splice(chooseTask(), 1)[0];
            nextTask.scheduled = false;
            nextTask.controller();
            idle = true;
            schedule();
        }, 0);
    }
}

function setPending(task, result, throwResult) {
    // NEWBORN, ACTIVE, or PAUSED
    if (task.controlState < ABORTED && (!task.pending || !task.pending.throw))
        task.pending = { value: result, throw: !!throwResult };
}

Task.prototype = {
    // ===== queries =====
    state: function() {
        return this.controlState;
    },

    // ===== target operations =====
    notify: function(evt) {
        if (this.blockedOn === evt) {
            evt.unblock(this);
            this.blockedOn = null;
            setPending(this, evt.readyState.value, evt.readyState.throw);
            schedule(this);
        }
    },

    // ===== state transitions =====
    start: function() {
        if (this.controlState !== NEWBORN)
            throw new Error("already started");
        this.controlState = ACTIVE;
        schedule(this);
    },
    unpause: function(x) {
        if (this.controlState !== PAUSED)
            throw new Error("not paused");
        this.controlState = ACTIVE;
        setPending(this, x);
        schedule(this);
    },
    pause: function() {
        if (this.controlState !== ACTIVE)
            throw new Error("task is not active");
        this.controlState = PAUSED;
    },
    stop: function() {
        var blocked = this.isBlocked();
        this.controlState = ABORTED;
        this.controller = aborted;
        if (this.blockedOn) {
            this.blockedOn.unblock(this);
            this.blockedOn = null;
        }
        schedule(this);
    },
    isBlocked: function() {
        // NEWBORN, ACTIVE, or PAUSED
        return !!(this.state < ABORTED && this.blockedOn);
    },
    toEvt: function() {
        return this.taskEvt;
    },
    toString: function() {
        return "[object Task " + this.tid + "]";
    }
};

global.jsTask = {
    uninstall: uninstall,
    NEWBORN: NEWBORN,
    ACTIVE: ACTIVE,
    PAUSED: PAUSED,
    ABORTED: ABORTED,
    CLOSED: CLOSED,
    Evt: Evt,
    Task: Task,
    join: join,
    choose: choose,
    spawn: spawn,
    TaskEvt: TaskEvt,
    ChoiceEvt: ChoiceEvt,
    JoinEvt: JoinEvt,
    GuardEvt: GuardEvt
};

})(this);
