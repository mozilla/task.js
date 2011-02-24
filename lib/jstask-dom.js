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

// A taskified version of XMLHttpRequest.

// Example:
// 
// var task = new Task(function() {
//     var request = new HttpRequest();
//     try {
//         var foo = yield request.send("foo.json");
//         var bar = yield request.send("bar.json");
//         var baz = yield request.send("baz.json");
//     } catch (errorResponse) {
//         console.log("failed HTTP request: " + errorResponse.statusText);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });

function HttpRequest() {
    this.xhr = new XMLHttpRequest();
}

HttpRequest.prototype = {
    send: function(url, method) {
        var task = Task.current;
        method = method || "GET";
        var xhr = this.xhr;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                return (xhr.status >= 400)
                    ? task.throw({ status: xhr.status, statusText: xhr.statusText })
                    : task.resume({
                          status: xhr.status,
                          statusText: xhr.statusText,
                          responseText: xhr.responseText,
                          responseXML: xhr.responseXML
                      });
            }
        }
        xhr.open(url, method, true);
    }
};

// A taskified timeout.

// Example:
// 
// var task = new Task(function() {
//     ...
//     yield sleep(500); // sleep for .5 sec
//     ...
// });

function sleep(delay) {
    var task = Task.current;
    window.setTimeout(function() {
        task.resume();
    }, delay);
}
