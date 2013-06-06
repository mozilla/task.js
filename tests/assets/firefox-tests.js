var Promise = RSVP.Promise;
var spawn = task.spawn;

Promise.resolve = RSVP.resolve;
Promise.reject = RSVP.reject;
Promise.wait = function (ms, value) {
    return new Promise(function (resolve) {
        setTimeout(function () {
            resolve(value);
        }, ms);
    });
};

// wrapper on top of Mocha's async support to trap assertion errors
// that would otherwise be caught by Task.js
function it(name, test) {
    if (test.length) {
        specify(name, function (done) {
            test.call(this, function (fn) {
                if (typeof fn === 'function') {
                    try {
                        fn();
                        done();
                    } catch (err) {
                        done(err);
                    }
                } else {
                    done(fn);
                }
            });
        });
    } else {
        specify(name, test);
    }
}

describe('task', function () {
    describe('spawn', function () {
        it('should return a new Task', function () {
            expect(spawn(function () {})).to.be.a(task.Task);
        });
    });
    describe('yield', function () {
        it('should retrieve a promise\'s value', function (done) {
            var expected = 'hello world';

            spawn(function () {
                var actual = yield Promise.resolve(expected);

                done(function () {
                    expect(actual).to.equal(expected);
                });
            });
        });
        it('should wait for promises to resolve', function (done) {
            var expected = 'hello world';

            spawn(function () {
                var actual = yield Promise.wait(50, expected);

                done(function () {
                    expect(actual).to.equal(expected);
                });
            });
        });
        it('should allow for catching rejected promises', function (done) {
            var expected = new Error('failed');

            spawn(function () {
                try {
                    yield Promise.reject(expected);
                } catch (error) {
                    done(function () {
                        expect(error).to.equal(expected);
                    });
                }
            });
        });
        it('should wait for multiple yields', function (done) {
            spawn(function () {
                var count = yield Promise.resolve(1);
                count = yield Promise.resolve(count + 2);
                count = yield Promise.resolve(count + 3);
                done(function () {
                    expect(count).to.equal(6);
                });
            });
        });
    });
    describe('Task as a promise', function () {
        it('should be a promise', function () {
            expect(spawn(function () {}).then).to.be.a('function');
        });
        it('should resolve to undefined', function (done) {
            spawn(function () {
                yield Promise.resolve(5);
            }).then(function (value) {
                done(function () {
                    expect(value).to.be(undefined);
                });
            });
        });
        it('should be rejected when a non-generator function is passed', function (done) {
            spawn(function () {}).then(null, function (error) {
                done(function () {
                    expect(error).to.be.an(Error);
                });
            });
        });
        it('should throw when passed non-generator function that throws', function () {
            var expected = new Error('failed');

            try {
                spawn(function () {
                    throw expected;
                });
            } catch (error) {
                expect(error).to.equal(expected);
            }
        });
        it('should be rejected when an error is thrown in the generator function', function (done) {
            var expected = new Error('failed');

            spawn(function () {
                var foo = yield Promise.resolve(5);
                throw expected;
            }).then(null, function (error) {
                done(function () {
                    expect(error).to.equal(expected);
                });
            });
        });
        it('should be rejected when a yielded rejected promise is uncaught', function (done) {
            var expected = new Error('failed');

            spawn(function () {
                yield Promise.reject(expected);
            }).then(null, function (error) {
                done(function () {
                    expect(error).to.equal(expected);
                });
            });
        });
    });
});
