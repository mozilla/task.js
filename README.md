# task.js

* *What?*  Cooperative concurrency for [ES6](http://wiki.ecmascript.org/doku.php?id=harmony:proposals)
* *Why?*   Who says JavaScript I/O has to be ugly?
* *Where?* [http://taskjs.org](http://taskjs.org)
* *When?*  As soon as your JS engine supports [generators](http://wiki.ecmascript.org/doku.php?id=harmony:generators)!
* *How?*   [http://taskjs.org](http://taskjs.org)

task.js provides an **automatic task scheduler** along with a library of first-class, synchronizable
events, making it easy to do **I/O without callbacks**.

With task.js you can write non-blocking I/O in a synchronous style, even with error handling:

``` javascript
spawn(function*() {
    try {
        var [foo, bar] = yield join(read("foo.json"),
                                    read("bar.json")).timeout(1000);
        render(foo);
        render(bar);
    } catch (e) {
        console.log("read failed: " + e);
    }
});
```

Compared with callbacks:

``` javascript
var foo, bar;
var tid = setTimeout(function() { failure(new Error("timed out")) }, 1000);

var xhr1 = makeXHR("foo.json",
                   function(txt) { foo = txt; success() },
                   function(err) { failure() });
var xhr2 = makeXHR("bar.json",
                   function(txt) { bar = txt; success() },
                   function(e) { failure(e) });

function success() {
    if (typeof foo === "string" && typeof bar === "string") {
        cancelTimeout(tid);
        xhr1 = xhr2 = null;
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
```

...tasks can be a lot simpler and cleaner. And unlike pre-emptive
threads, `yield` always makes it clear where tasks block.

# Contributing

Currently the best way to contribute is to **hang out on IRC**: the
channel is `#task.js` on [irc.mozilla.org](http://irc.mozilla.org). Or
you can always send me email (my Github nick at mozilla.com). And I'm
always happy to accept pull requests!

If you're looking for interesting things to work on, check out the
**[issue tracker](task.js/issues)**.
