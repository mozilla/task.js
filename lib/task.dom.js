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
task.dom = (function(taskJS) {

var Promise = taskJS.Promise;
var Deferred = taskJS.Deferred;
var Task = taskJS.Task;

// Synchronizable XMLHttpRequest.

// Example 1 (sequential):
// 
// spawn(function() {
//     try {
//         var foo = yield read("foo.json");
//         var bar = yield read("bar.json");
//         var baz = yield read("baz.json");
//     } catch (e) {
//         console.log("failed HTTP request: " + e.message);
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
//     } catch (e) {
//         console.log("failed HTTP request: " + e.message);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });

// Example 3 (interleaved, using promise results):
// 
// spawn(function() {
//     try {
//         var [foo, bar, baz] = yield join(read("foo.json"),
//                                          read("bar.json"),
//                                          read("baz.json"));
//     } catch (e) {
//         console.log("failed HTTP request: " + e.message);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });

/** @export function(string, string="GET") : Promise<{ status: string, statusText: string, responseText: string, responseXML: string }> */
function read(url, method) {
    method = method || "GET";
    var xhr = new XMLHttpRequest();
    var deferred = new Deferred();
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status >= 400) {
                var e = new Error(xhr.statusText);
                e.status = xhr.status;
                deferred.reject(e);
            } else {
                deferred.resolve({
                    status: xhr.status,
                    statusText: xhr.statusText,
                    responseText: xhr.responseText,
                    responseXML: xhr.responseXML
                });
            }
        }
    };
    xhr.open(method, url, true);
    xhr.send();
    return deferred.promise;
}

// // Synchronizable delay.

// // Example:
// // 
// // spawn(function() {
// //     ...
// //     yield sleep(500); // sleep for .5 sec
// //     ...
// // });

// /** @export function(Uint32, boolean=false) : Promise<Uint32> */
// function sleep(delay, compensate) {
//     var start = Date.now();
//     var deferred = new Deferred();
//     var id = setTimeout(resolveOrTryAgain, delay);

//     function resolveOrTryAgain() {
//         var end = Date.now();
//         var actual = end - start;
//         if (compensate && actual < delay) {
//             id = setTimeout(resolveOrTryAgain, delay - actual);
//             return;
//         }
//         deferred.resolve(actual);
//     }

//     return deferred.promise;
// }

return {
    read: read
};

})(task);
