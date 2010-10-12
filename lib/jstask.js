/*
 * jstask.js
 *
 * Copyright (c) 2010 David Herman <dherman@ccs.neu.edu>
 */

function Task(thunk) {
    this.generator = thunk.call(this);
}

Task.prototype = {
    start: function() { this.generator.next(); },
    resume: function(x) { this.generator.send(x); },
    throw: function(x) { this.generator.throw(x); }
};
