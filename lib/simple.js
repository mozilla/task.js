// This is an attempt at a stripped-down version of task.js, and I think should
// eventually replace the existing one. There might be a place for the one that
// allows custom scheduling policies, but I think there'd likely be more demand
// for a minimal task.js library.

// This is as of yet untested.

// Changes implemented here:
//
// - Tasks are not promises, but contain a .result property that is a promise.
// - Uses the proper ES6 iterator/generator protocol.
// - Uses RSVP for promises.
// - Uses ES6 modules.

import { Promise, async } from "RSVP";

const T_PAUSED    = 0;  // can't be scheduled or executed
const T_STARTED   = 1;  // may or may not currently be executing
const T_CANCELLED = 2;  // cancelled but not yet done cleaning up
const T_CLOSED    = 3;  // completely done

const R_BLOCKED   = 0;  // waiting on a promise
const R_RESOLVED  = 1;  // ready to resume with a resolved value
const R_REJECTED  = 2;  // ready to resume with a rejected value
const R_RUNNING   = 3;  // currently executing

var counter = 0;

export function Task(thunk) {
  this._tid = (++counter) & 0xffffffff;
  this._result = undefined;
  this._runState = R_RESOLVED;
  this._threadState = T_PAUSED;
  this._thread = thunk.call(this);
  var self = this;
  this.result = new Promise(function(resolve, reject) {
    self._resolve = resolve;
    self._reject = reject;
  });
}

Task.current = function() {
  return ticking;
};

export function spawn(thunk) {
  return (new Task(thunk)).start();
}

function tick(task) {
  var result = task._result,
      resolve = (task._runState === R_RESOLVED);

  task._runState = R_RUNNING;
  task._result = undefined;
  if (task._threadState === T_CANCELLED) {
    task._thread = null;
    task._result = undefined;
    task._runState = R_RESOLVED;
    task._threadState = T_CLOSED;
  } else if (task._threadState !== T_PAUSED) {
    ticking = task;
    try {
      var next = resolve
               ? task._thread.next(result)
               : task._thread["throw"](result);
      if (next.done) {
        var value = next.value;
        task._result = value;
        task._runState = R_RESOLVED;
        task._threadState = T_CLOSED;
        task._resolve(value);
      } else {
        task._runState = R_BLOCKED;
        next.value.then(function(value) {
          task._result = value;
          task._runState = R_RESOLVED;
          if (task._threadState === T_STARTED)
            tick(task);
        }, function(error) {
          task._result = error;
          task._runState = R_REJECTED;
          if (task._threadState === T_STARTED)
            tick(task);
        });
      }
    } catch (error) {
      task._result = error;
      task._runState = R_REJECTED;
      task._threadState = T_CLOSED;
      task._reject(error);
    }
    ticking = null;
  }
}

var ticking = null;

var Tp = Task.prototype;

Tp.isStarted = function() {
    return this._threadState === T_STARTED;
};

Tp.isRunning = function() {
    return this._runState === R_RUNNING;
};

Tp.start = function() {
  if (this._threadState !== T_PAUSED)
    throw new Error("task is already started or completed");
  this._threadState = T_STARTED;
  if (this._runState !== R_BLOCKED) {
    var self = this;
    async(function() {
      tick(self);
    });
  }
  return this;
};

Tp.pause = function() {
  if (this._runState === R_RUNNING)
    throw new Error("tasks can only be paused while blocked");
  this._threadState = T_PAUSED;
  return this;
};

Tp.cancel = function() {
  if (this.runState === R_RUNNING)
    throw new Error("tasks can only be cancelled while blocked");
  this._threadState = T_CANCELLED;
  var self = this;
  async(function() {
    tick(self);
  });
  return this;
};

Tp.toString = function() {
    return "[object Task " + this._tid + "]";
};
