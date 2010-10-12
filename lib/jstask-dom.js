/*
 * jstask-dom.js
 *
 * Copyright (c) 2010 David Herman <dherman@ccs.neu.edu>
 */

// A taskified version of XMLHttpRequest.

// Example:
// 
// var task = new Task(function() {
//     var request = new HttpRequest();
//     try {
//         var foo = yield request.send(this, "foo.json");
//         var bar = yield request.send(this, "bar.json");
//         var baz = yield request.send(this, "baz.json");
//     } catch (errorResponse) {
//         console.log("failed HTTP request: " + errorResponse.statusText);
//     }
//     ... foo.responseText ... bar.responseText ... baz.responseText ...
// });

function HttpRequest() {
    this.xhr = new XMLHttpRequest();
}

HttpRequest.prototype = {
    send: function(task, url, method) {
        method = method || "GET";
        var xhr = this.xhr;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                return (xhr.status >= 400)
                    ? task.throw({ status: xhr.status, statusText: xhr.statusText })
                    : task.resume({ status: xhr.status, statusText: xhr.statusText, responseText: xhr.responseText, responseXML: xhr.responseXML });
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
//     yield sleep(this, 500); // sleep for .5 sec
//     ...
// });

function sleep(task, delay) {
    window.setTimeout(function() {
        task.resume();
    }, delay);
}
