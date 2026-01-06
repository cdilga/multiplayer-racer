# Testing Fixes

How to make our tests run faster

Currently our tests are far to slow. Generally, with few exceptions our tests could all be run immediately. There are a few issues which slow testing.

1. Browser instantiation time. It takes a while for playwright to do the first load of our page. For us, this is decent as Rapier does take a moment to initialise. 
  - Make rapier initialisation faster
  - Remove loading spinners
  - Ensure the initial load is as fast as is possible
  - Add an initialisation flag we can pass to skip the countdown and instantly spawn in at a given state

2. Remove CDN dependencies and optimise bundle delivery 
  - On first load, which happens many times - we wait for CDN assets
  - This is just ridiculously slow - and could be improved
  - Add NPM deps for rapier etc and remove all script tags for rapier , three.js and the like.
  - Resolve console warnings like: `
  'Scripts "build/three.js" and "build/three.min.js" are deprecated with r150+, and will be removed with r160. Please use ES Modules or alternatives: https://threejs.org/docs/index.html#manual/en/introduction/Installation',`

3. Generally - we wait too long in our tests
  - For the braking test, accelearation test, we just wait way longer than needed
  - Timeouts to validate things are just far too slow, more than necessary
  - Instead, use events and make sure we start asap
  - Start by setting the timer for each test to 5 seconds, we should be able to get things done within that time
  - Add a single test which is our "realtime" test - which covers several of the physics interactions

4. We can investigate whether we can pre-setup our playwright instance. In theory, once testing it's a single version of the game. We could do client side caching for our investigations
  - Implement a playwright setup cache
  - Introduce parallelism for our tests
  - This may break as we haven't previously supported running 2 different game rooms from a single server, so we would need to watch for weird behaviours

5. Some tests are covered by other tests and can just be removed or simplified
  - Tests can be more targeted and simpler. 
  - These are end to end tests, so while a few strategic tests are good, we might need to do multiple assertions along the way in the interests of time. 
  - For example, our test showing that some inputs work also contain other inputs, which is good. We could combine to do driving forwards, coasting, turning, stopping, reversing all together or similar. The time between these need not be very long
 
6. Physics tests
 - We can run all but the most basic of physics tests at an increased speed
 - Choose a tickrate, can be 4x or 8x the current speed
 - May miss or even introduce additional bugs, but it should still work

