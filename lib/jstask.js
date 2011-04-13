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

/** @module */
jsTask = (function(global) {

var hasPrevious = "jsTask" in global;
var previous = global.jsTask;

/** @export function() : jsTask */
function uninstall() {
    var jsTask = global.jsTask;
    if (hasPrevious)
        global.jsTask = previous;
    else
        delete global.jsTask;
    return jsTask;
}

var isGenerator = Function.isGenerator || function() { return true };

/** @private class ObjectMap<K,V>([{ key: K, value: V }] | null | undefined) */
function ObjectMap(array) {
    this.array = array || [];
}

/** @private function<K,V,A>(ObjectMap<K,V>, K, V, function(V, Uint32) : A, function() : A) : A */
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
    // FIXME: need a more efficient way of doing this, without cloning
    forEach: function(f) {
        // clone the array to be safe for concurrent removal
        var a = this.array.map(function(pair) { return pair });
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
                         function(pair, i) { return a.splice(i, 1)[0].value },
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

function enqueue(thunk) {
    setTimeout(thunk, 0);
}

/** @private typedef Signal { value: any, throw: boolean } */
/** @export typedef Waiter { notify: function(Sync, Signal) : void } */

/** @export class Sync<A>(object) */
function Sync(methods) {
    for (var key in methods) {
        if (key !== "waiting")
            this[key] = methods[key];
    }
    this.waiting    /** @private ObjectMap<Waiter, true> */ = new ObjectMap();
    //this.readyState /** @private (Signal | false | null) */ = null;
}

/** @public function(any) : Sync */
Sync.from = function(x) {
    while (!(x instanceof Sync)) {
        if (typeof x !== "object" || x === null || typeof x.toSync !== "function")
            return null;
        x = x.toSync();
    }
    return x;
};

Sync.prototype = {
    /**
     * @override function() : void
     * @throws never
     */
    onCancel: function() { },

    /**
     * @override function() : void
     * @throws never
     */
    onReady: function() { },

    /**
     * @override function() : void
     * @throws never
     */
    onSync: function() { },

    /**
     * @public function() : void
     * @throws never
     */
    cancel: function() {
        //this.readyState = false;
        this.onCancel();
    },

    /**
     * @protected function(Signal) : void
     * @throws never
     */
    fulfill: function(signal) {
        this.onReady(signal);
        this.notifyAll(signal);
    },

    /**
     * @protected function(any) : void
     * @throws never
     */
    return: function(value) {
        this.fulfill({ value: value, throw: false });
    },

    /**
     * @protected function(any) : void
     * @throws never
     */
    throw: function(value) {
        this.fulfill({ value: value, throw: true });
    },

    /**
     * @private function(Signal) : void
     * @throws never
     */
    notifyAll: function(signal) {
        var sync = this;
        this.waiting.forEach(function(waiter) {
            waiter.notify(sync, signal);
        });
    },

    /** @protected function(Waiter) : void */
    block: function(waiter) {
        this.waiting.set(waiter, true);
    },

    /** @protected function(Waiter) : void */
    unblock: function(waiter) {
        this.waiting.remove(waiter);
        // FIXME: are there cases where we could end up being re-blocked after being unblocked?
        if (!this.waiting.size)
            this.cancel();
    },

    /** @public function(...Sync) : Sync */
    or: function() {
        var a = [this];
        a.push.apply(a, arguments);
        return new ChoiceSync(a);
    },

    /** @public function(...Sync) : Sync */
    and: function() {
        var a = [this];
        a.push.apply(a, arguments);
        return new JoinSync(a);
    },

    /** @public function(function(any) : any, function(any) : any) : Sync */
    guard: function(onsuccess, onfailure) {
        return new GuardSync(this, onsuccess, onfailure);
    },

    /** @public function(function(any) : any, function(any) : any) : Sync */
    with: function(onsuccess, onfailure) {
        return new GuardSync(this, onsuccess, onfailure);
    }

};

/** @export class TaskSync(Task) is Sync<Uint32> */
function TaskSync(task) {
    this.task = task;
}

TaskSync.prototype = new Sync({
    onCancel: function() {
        this.task.stop();
    },
});

// FIXME: unblock whenever we cancel or close a sync?

/** @export class JoinSync<...A>([Sync<A>]) is Sync<[...A]> */
function JoinSync(syncs) {
    this.results = new Array(syncs.length);
    var pendingSyncs = new ObjectMap();
    var self = this;
    syncs.forEach(function(sync, i) {
        sync.block(self);
        pendingSyncs.set(sync, i);
    });
    this.pendingSyncs = pendingSyncs;
}

JoinSync.prototype = new Sync({
    onCancel: function() {
        this.pendingSyncs.forEach(function(sync) {
            sync.cancel();
        });
    },
    onReady: function(signal) {
        if (signal.throw) {
            this.pendingSyncs.forEach(function(sync) {
                sync.cancel();
            });
        }
    },
    /** @protected function(Sync, Signal) : void */
    notify: function(sync, signal) {
        var idx = this.pendingSyncs.remove(sync);
        if (idx != null) {
            if (signal.throw) {
                this.fulfill(signal);
            } else {
                this.results[idx] = signal.value;
                if (!this.pendingSyncs.size)
                    this.fulfill({ value: this.results, throw: false });
            }
        }
    }
});

/** @export class ChoiceSync<A>([Sync<A>]) is Sync<A> */
function ChoiceSync(syncs) {
    this.syncs = syncs;
    var self = this;
    syncs.forEach(function(sync) {
        sync.block(self);
    });
}

// FIXME: variations that prefer exceptions or that prefer non-exceptions?
ChoiceSync.prototype = new Sync({
    onCancel: function() {
        this.syncs.forEach(function(sync) {
            sync.cancel();
        });
    },
    /** @protected function(Sync) : void */
    notify: function(sync, signal) {
        this.syncs.forEach(function(sync2) {
            if (sync2 !== sync)
                sync2.cancel();
        });
        this.fulfill(signal);
    }
});

/** @export class GuardSync<A,B>(Sync<A>, function(A) : B, function(A) : any) is Sync<B> */
function GuardSync(sync, onsuccess, onfailure) {
    sync.block(this);
    this.sync = sync;
    this.onsuccess = onsuccess;
    this.onfailure = onfailure;
}

GuardSync.prototype = new Sync({
    onCancel: function() {
        this.sync.cancel();
    },
    notify: function(sync, signal) {
        try {
            if (signal.throw) {
                var guard = this.onfailure;
                if (!guard)
                    this.fulfill(signal);
                else
                    this.fulfill({ value: guard(signal.value), throw: true });
            } else {
                var guard = this.onsuccess;
                this.fulfill({ value: guard(signal.value), throw: false });
            }
        } catch (e) {
            this.fulfill({ value: e, throw: true });
        }
    }
});

/** @export function<...A>(...Sync<A>) : Sync<[...A]> */
function join() {
    var syncs = [];
    for (var i = 0, n = arguments.length; i < n; i++)
        syncs.push(arguments[i]);
    return new JoinSync(syncs);
}

/** @export function<A>(...Sync<A>) : Sync<A> */
function choose() {
    var syncs = [];
    for (var i = 0, n = arguments.length; i < n; i++)
        syncs.push(arguments[i]);
    return new ChoiceSync(syncs);
}

/** @export Sync<true> */
Sync.ALWAYS = new Sync({
    onSync: function() {
        this.return(true);
    }
});

/** @export Sync<never> */
Sync.NEVER = new Sync();


const NEWBORN   /** @export Uint32 */ = 0;   // not yet started
const STARTED   /** @export Uint32 */ = 1;   // may or may not currently be executing
const PAUSED    /** @export Uint32 */ = 2;   // paused
const CANCELLED /** @export Uint32 */ = 3;   // cancelled but not yet done cleaning up
const CLOSED    /** @export Uint32 */ = 4;   // completely done

/** @export typedef ControlState enum(NEWBORN | STARTED | PAUSED | CANCELLED | CLOSED) */

var counter = 0;
function nextTID() {
    var result = counter;
    counter = (counter + 1) & 0xffff;
    return result;
}

/**
 * @private typedef Controller function() : void
 * @throws never
 */

/** @private Controller */
function newborn() {
    this.controlState = STARTED;
    this.controller = started;
    return this.controller();
}

/** @private Controller */
function started() {
    var thread = this.thread;
    try {
        if (!this.isBlocked()) {
            var pending = this.pending;
            this.pending = null;
            this.running = true;

            // resume the task
            current = this;
            var sync = Sync.from(!pending
                                 ? thread.next()
                                 : pending.throw
                                 ? thread.throw(pending.value)
                                 : thread.send(pending.value));
            current = null;
            this.running = false;

            if (sync) {
                sync.block(this);
                this.blockedOn = sync;
                sync.onSync();
            }
        }
        schedule(this);
    } catch (e) {
        var now = Date.now();
        if (e === StopIteration) {
            this.taskSync.fulfill({ value: now, throw: false });
        } else {
            this.uncaught = { value: e };
            this.taskSync.fulfill({ value: e, throw: true });
        }
        shutdown(this);
    }
}

/** @private Controller */
function cancelled() {
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
    this.taskSync.fulfill({ value: Date.now(), throw: false });
    shutdown(this);
}

/**
 * @private function(Task) : void
 * @throws never
 */
function shutdown(task) {
    current = null;
    task.running = false;
    task.controlState = CLOSED;
    task.thread = null;
    task.controller = null;
    task.blockedOn = null;
}

// FIXME: runState ::= DORMANT | SCHEDULED | RUNNING

// FIXME: eliminate taskSync; Task should be <: Sync

/** @export class Task(function() :* any) */
function Task(thunk) {
    if (!isGenerator(thunk))
        throw new TypeError("expected generator function, got " + thunk);
    
    this.tid          /** @private Uint32 */             = nextTID();
    this.uncaught     /** @private any */                = null;
    this.pending      /** @private Signal */             = null;
    this.running      /** @private boolean */            = false;
    this.scheduled    /** @private boolean */            = false;
    this.blockedOn    /** @private (Sync<any> | null) */ = null;
    this.thread       /** @private Generator */          = thunk.call(this);
    this.controlState /** @private ControlState */       = NEWBORN;
    this.controller   /** @private Controller */         = newborn;
    this.taskSync     /** @private TaskSync */           = new TaskSync(this);
}

/** @export function(function() :* any) : Task */
function spawn(thunk) {
    var task = new Task(thunk);
    task.start();
    return task;
}

var current = null;

/** @export function() : Task */
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

/** @private function(Task) : void */
function schedule(task) {
    if (task && !task.scheduled) {
        switch (task.controlState) {
          case STARTED:
            if (task.blockedOn)
                break;
            // FALL THROUGH
          case CANCELLED:
            task.scheduled = true;
            readyTasks.push(task);
        }
    }
    if (idle && readyTasks.length) {
        idle = false;
        var stack = currentStack();
        jsTask.enqueue(function() {
            var nextTask = readyTasks.splice(chooseTask(), 1)[0];
            nextTask.scheduled = false;
            nextTask.controller();
            idle = true;
            schedule();
        });
    }
}

/** @private function(Task, any, boolean) : void */
function setPending(task, result, throwResult) {
    // NEWBORN, STARTED, or PAUSED
    if (task.controlState < CANCELLED && (!task.pending || !task.pending["throw"]))
        task.pending = { value: result, "throw": !!throwResult };
}

// FIXME: ensure task can only be blocked on one sync (e.g., disallow blocking when not running)

Task.prototype = {
    // ===== queries =====

    /** @public function() : ControlState */
    state: function() {
        return this.controlState;
    },

    // ===== waiter operations =====

    /** @protected function(Sync<any>, Signal) : void */
    notify: function(sync, signal) {
        if (this.blockedOn === sync) {
            sync.unblock(this);
            this.blockedOn = null;
            setPending(this, signal.value, signal.throw);
            schedule(this);
        }
    },

    // ===== state transitions =====

    /** @public function() : void */
    start: function() {
        if (this.controlState !== NEWBORN)
            throw new Error("already started");
        this.controlState = STARTED;
        schedule(this);
    },
    /** @public function(any) : void */
    unpause: function(x) {
        if (this.controlState !== PAUSED)
            throw new Error("not paused");
        this.controlState = STARTED;
        setPending(this, x);
        schedule(this);
    },
    /** @public function() : void */
    pause: function() {
        if (this.controlState !== STARTED)
            throw new Error("task is not started");
        this.controlState = PAUSED;
    },
    /** @public function() : void */
    stop: function() {
        var blocked = this.isBlocked();
        this.controlState = CANCELLED;
        this.controller = cancelled;
        if (this.blockedOn) {
            this.blockedOn.unblock(this);
            this.blockedOn = null;
        }
        schedule(this);
    },
    /** @protected function() : void */
    isBlocked: function() {
        // NEWBORN, STARTED, or PAUSED
        return !!(this.state < CANCELLED && this.blockedOn);
    },
    /** @public function() : Sync<Uint32> */
    toSync: function() {
        return this.taskSync;
    },
    /** @public function() : string */
    toString: function() {
        return "[object Task " + this.tid + "]";
    }
};

return {
    uninstall: uninstall,
    NEWBORN: NEWBORN,
    STARTED: STARTED,
    PAUSED: PAUSED,
    CANCELLED: CANCELLED,
    CLOSED: CLOSED,
    enqueue: enqueue,
    Sync: Sync,
    Task: Task,
    join: join,
    choose: choose,
    spawn: spawn,
    TaskSync: TaskSync,
    ChoiceSync: ChoiceSync,
    JoinSync: JoinSync,
    GuardSync: GuardSync
};

})(this);
