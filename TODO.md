# TO DO

* make schedulers first-class; make it possible to create multiple schedulers
* enforce that `fulfill` does nothing if a task has been killed
* `join` should use cycle (i.e., deadlock) detection
* optionally have exceptions *not* kill join-peers but rather detach them from the blocked task
* better PRNG for task scheduler and choice demand
* object-detect for `WeakMap` instead of `ObjectMap` (or do we need strong `Map`?)
* see if we can avoid object-valued maps altogether
* make `Task`/`Sync` internals closure-private?
* make sure we're nulling out all important properties when a task dies
* create a deterministic scheduler for testing
* test suite
* more API docs
* more DOM-sync abstractions
* jQuery-like `ready` function that takes a generator function
