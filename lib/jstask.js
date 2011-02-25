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
//  - better state checking (e.g., disallow resume when newborn)
//  - 

function Task(thunk) {
    var self = this;
    this.generator = (function() {
        // NB: this would be more concise with yield*
        for (var x in thunk.call(self))
            yield x;
        var joined = self.joined;
        while (joined.length > 0)
            joined.pop().notify();
        self.generator = null;
    })();
    this.joined = [];
    this.blockedOn = 0;
}

function join() {
    for (var i = 0, j = arguments.length; i < j; i++)
        arguments[i].join();
}

(function() {
    var current = null;

    Task.current = function() {
        return current;
    }

    function withCurrent(task, thunk) {
        var previous = current;
        current = task;
        try {
            thunk();
        } catch (e) {
            if (e !== StopIteration)
                throw e;
        } finally {
            current = previous;
        }
    }

    Task.prototype = {
        checkInactive: function(action) {
            if (this === current)
                throw new Error("cannot " + action + " active task");
        },
        start: function() {
            this.checkInactive("restart");
            var generator = this.generator;
            var self = this;
            this.schedule(function() { withCurrent(self, function() { generator.next() }); });
        },
        stop: function() {
            this.checkInactive("kill");
            this.generator.close();
        },
        resume: function(x) {
            this.checkInactive("resume");
            var generator = this.generator;
            var self = this;
            this.schedule(function() { withCurrent(self, function() { generator.send(x) }); });
        },
        throw: function(x) {
            this.checkInactive("resume");
            var generator = this.generator;
            var self = this;
            this.schedule(function() { withCurrent(self, function() { generator.throw(x) }); });
        },
        join: function() {
            this.checkInactive("join");
            if (current === null)
                throw new Error("no active task to join");
            this.joined.push(current);
            current.blockedOn++;
        },
        notify: function() {
            if (this.generator && (--this.blockedOn === 0)) {
                var self = this;
                this.schedule(function() { self.resume(); });
            }
        },
        // NB: set this method to do something useful depending on host environment
        schedule: function() {
            throw new Error("no schedule method installed");
        }
    };
})();
