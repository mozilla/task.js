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

(function() {

var Evt = jsTask.Evt;
var Task = jsTask.Task;

// A taskified version of XMLHttpRequest.

// Example 1 (sequential):
// 
// spawn(function() {
//     try {
//         var foo = yield read("foo.json");
//         var bar = yield read("bar.json");
//         var baz = yield read("baz.json");
//     } catch (errorResponse) {
//         console.log("failed HTTP request: " + errorResponse.statusText);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });

// Example 2 (interleaved):
// 
// spawn(function() {
//     try {
//         var foo, bar, baz;
//         yield join(spawn(function() { foo = yield read("foo.json"); }),
//                    spawn(function() { bar = yield read("bar.json"); }),
//                    spawn(function() { baz = yield read("baz.json"); }));
//     } catch (errorResponse) {
//         console.log("failed HTTP request: " + errorResponse.statusText);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });

// Example 3 (interleaved, using first-class events):
// 
// spawn(function() {
//     try {
//         var [foo, bar, baz] = yield join(read("foo.json"),
//                                          read("bar.json"),
//                                          read("baz.json"));
//     } catch (errorResponse) {
//         console.log("failed HTTP request: " + errorResponse.statustext);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });
           
function ReadEvt(url, method) {
    this.url = url;
    this.method = method || "GET";
    var xhr = new XMLHttpRequest();
    var evt = this;
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status >= 400) {
                evt.fulfill({
                    status: xhr.status,
                    statusText: xhr.statusText
                }, true);
            } else {
                evt.fulfill({
                    status: xhr.status,
                    statusText: xhr.statusText,
                    responseText: xhr.responseText,
                    responseXML: xhr.responseXML
                });
            }
        }
    };
    this.xhr = xhr;
}

ReadEvt.prototype = new Evt({
    cancel: function() {
        this.xhr.abort();
    }
});

function HttpRequest() {
    this.xhr = new XMLHttpRequest();
}

HttpRequest.prototype = {
    send: function(url, method) {
        var task = Task.current();
        method = method || "GET";
        var xhr = this.xhr;
        var id = task.setCancelHandler(this.cancel.bind(this));
        task.block(xhr);
        xhr.onreadystatechange = function() {
            //console.log("onreadystatechange: " + xhr.readyState);
            if (xhr.readyState === 4) {
                task.clearCancelHandler(id);
                if (xhr.status >= 400) {
                    task.fulfill(xhr, {
                        status: xhr.status,
                        statusText: xhr.statusText
                    }, true);
                } else {
                    task.fulfill(xhr, {
                        status: xhr.status,
                        statusText: xhr.statusText,
                        responseText: xhr.responseText,
                        responseXML: xhr.responseXML
                    });
                }
            }
        }
        xhr.open(method, url, true);
        xhr.send();
    },
    cancel: function() {
        //console.log("cancelling read");
        this.xhr.abort();
    }
};

// function read(url, method) {
//     return new ReadEvt(url, method);
// }

function read(url) {
    var request = new HttpRequest();
    return request.send(url);
}

// A taskified timeout.

// Example:
// 
// spawn(function() {
//     ...
//     yield sleep(500); // sleep for .5 sec
//     ...
// });

function SleepEvt(delay) {
    this.delay = delay;
    var evt = this;
    var timeoutID = setTimeout(function() {
        var end = Date.now();
        this.timeoutID = null;
        evt.fulfill(end - start);
    });
    this.timeoutID = timeoutID;
}

SleepEvt.prototype = new Evt({
    cancel: function() {
        if (this.timeoutID !== null)
            clearTimeout(this.timeoutID);
    }
});

// function sleep(delay) {
//     return new SleepEvt(delay);
// }

function sleep(delay) {
    var task = Task.current();
    //console.log("task " + task + " is requesting sleep");
    var blocker = {};
    task.block(blocker);
    var taskCancelID, timeoutID;
    taskCancelID = task.setCancelHandler(function() {
        //console.log("cancelling sleep for " + task);
        clearTimeout(timeoutID);
    });
    timeoutID = setTimeout(function() {
        task.clearCancelHandler(taskCancelID);
        task.fulfill(blocker);
    }, delay);
}

jsTask.DOM = {
    read: read,
    sleep: sleep
};

})();
