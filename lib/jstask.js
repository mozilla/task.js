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
//  - join should use cycle (i.e., deadlock) detection
//  - optionally have exceptions *not* kill join-peers but rather detach them
//    from the blocked task
//  - better PRNG for task scheduler
//  - object-detect for WeakMap instead of ObjectMap (or do we need strong Map?)
//  - see if we can avoid object-valued maps altogether
//  - make Task internals closure-private?
//  - make sure we're nulling out all important properties when a task dies
//  - create a deterministic scheduler for testing
//  - test suite
//  - API docs

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
        searchMap(this, x,
                  function(pair, i) { a.splice(i, 1) },
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

function Task(thunk) {
    if (!isGenerator(thunk))
        throw new TypeError("expected generator function, got " + thunk);
    this.tid = nextTID();
    this.uncaught = null;
    this.pending = null;
    this.running = false;
    this.controlState = NEWBORN;
    this.waiting = [];
    this.blockers = new ObjectMap();
    this.thread = thunk.call(this);
    // FIXME: controller can just be a thunk, not a generator
    this.controller = (function() {
        yield;

        this.controlState = ACTIVE;

        var thread = this.thread;

        // main control loop
        while (true) {
            if (this.controlState === ABORTED) {
                console.log("aborting " + this);
                try {
                    this.running = true;
                    current = this;
                    thread.close();
                } catch (e) {
                    if (e !== StopIteration)
                        this.uncaught = { value: e };
                } finally {
                    this.running = false;
                    this.controlState = CLOSED;
                    break;
                }
            }

            // resume thread to next cooperative yield
            try {
                if (this.controlState === ACTIVE && !this.blockers.size) {
                    var pending = this.pending;
                    this.pending = null;
                    this.running = true;
                    current = this;
                    if (!pending)
                        thread.next();
                    else if (pending.throw)
                        thread.throw(pending.value);
                    else
                        thread.send(pending.value);
                    current = null;
                    this.running = false;
                }
                schedule(this);
                yield;
            } catch (e) {
                current = null;
                this.running = false;
                this.controlState = CLOSED;
                if (e !== StopIteration) {
                    this.uncaught = { value: e };
                    var blocker = this;
                    this.waiting.forEach(function(waiter) {
                        // propagate the exception to the waiter
                        setPending(waiter, e, true);

                        // abort any other tasks blocking the waiter
                        waiter.blockers.forEach(function(otherBlocker) {
                            if (otherBlocker !== blocker && otherBlocker.controlState !== CLOSED)
                                otherBlocker.controlState = ABORTED;
                        });
                    });
                }
                break;
            }
        }

        // shut-down: notify all blocked tasks that we're dead
        var waiting = this.waiting;
        while (waiting.length)
            waiting.pop().fulfill(this);
        console.log(this + ".controller shutting down");
        this.thread = null;
        this.controller = null;
        this.blockers = null;
        this.waiting = null;

        yield; // avoid throwing StopIteration
    }).call(this);
    this.controller.next(); // advance to first yield
}

function spawn(thunk) {
    var task = new Task(thunk);
    task.start();
    return task;
}

function join() {
    if (current === null)
        throw new Error("no running task to join");
    current.join.apply(current, arguments);
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

var readyTasks = [];

// no task is currently executing
var idle = true;

function schedule(task) {
    if (task) {
        switch (task.controlState) {
          case ACTIVE:
            if (task.blockers.size)
                break;
            // FALL THROUGH
          case ABORTED:
            readyTasks.push(task);
        }
    }
    if (idle && readyTasks.length) {
        idle = false;
        setTimeout(function() {
            // FIXME: use a better PRNG
            var i = Math.floor(Math.random() * readyTasks.length);
            var nextTask = readyTasks.splice(i, 1)[0];
            nextTask.controller.next();
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
    get state() {
        return this.controlState;
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
        this.controlState = ABORTED;
        schedule(this);
    },
    block: function(blocker) {
        if (blocker !== blocker)
            throw new TypeError("cannot block on NaN");
        this.blockers.set(blocker, true);
    },
    fulfill: function(blocker, result, throwResult) {
        this.blockers.remove(blocker);
        setPending(this, result, throwResult);
        schedule(this);
    },
    join: function() {
        for (var i = 0, j = arguments.length; i < j; i++) {
            var blocker = arguments[i];
            blocker.waiting.push(this);
            this.blockers.set(blocker, true);
        }
    },
    toString: function() {
        return "[object Task:" + this.tid + "]";
    }
};

global.jsTask = {
    uninstall: uninstall,
    NEWBORN: NEWBORN,
    ACTIVE: ACTIVE,
    PAUSED: PAUSED,
    ABORTED: ABORTED,
    CLOSED: CLOSED,
    Task: Task,
    join: join,
    spawn: spawn
};

})(this);
