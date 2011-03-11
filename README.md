# jstask.js

*by [Dave Herman](http://blog.mozilla.com/dherman)*

Lightweight, cooperative tasks for JavaScript with [generators](https://developer.mozilla.org/en/New_in_JavaScript_1.7).

jsTask provides an **automatic task scheduler** along with a library of first-class, synchronizable
events, making it easy to do **I/O without callbacks**.

jsTask lets you write this code:

    spawn(function() {
        try {
            var [foo, bar] = yield join(read("foo.json"),
                                        read("bar.json")).timeout(1000);
            render(foo);
            render(bar);
        } catch (e) {
            console.log("read failed: " + e);
        }
    });

instead of, say, this code:

    var foo, bar;
    var tid = setTimeout(function() { failure(new Error("timed out")) }, 1000);
    
    var xhr1 = makeXHR("foo.json",
                       function(txt) { foo = txt; success() },
                       function(err) { failure() });
    var xhr2 = makeXHR("bar.json",
                       function(txt) { bar = txt; success() },
                       function(e) { failure(e) });
    
    function success() {
        if (!timedOut && typeof foo === "string" && typeof bar === "string") {
            cancelTimeout(tid);
            xhr1 = null;
            xhr2 = null;
            render(foo);
            render(bar);
        }
    }
    
    function failure(e) {
        xhr1 && xhr1.abort();
        xhr1 = null;
        xhr2 && xhr2.abort();
        xhr2 = null;
        console.log("read failed: " + e);
    }
