'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function subscribe(store, callback) {
    const unsub = store.subscribe(callback);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
    let value;
    subscribe(store, _ => value = _)();
    return value;
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
}
function getContext(key) {
    return get_current_component().$$.context.get(key);
}

// source: https://html.spec.whatwg.org/multipage/indices.html
const boolean_attributes = new Set([
    'allowfullscreen',
    'allowpaymentrequest',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'hidden',
    'ismap',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected'
]);

const invalid_attribute_name_character = /[\s'">/=\u{FDD0}-\u{FDEF}\u{FFFE}\u{FFFF}\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;
// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
// https://infra.spec.whatwg.org/#noncharacter
function spread(args, classes_to_add) {
    const attributes = Object.assign({}, ...args);
    if (classes_to_add) {
        if (attributes.class == null) {
            attributes.class = classes_to_add;
        }
        else {
            attributes.class += ' ' + classes_to_add;
        }
    }
    let str = '';
    Object.keys(attributes).forEach(name => {
        if (invalid_attribute_name_character.test(name))
            return;
        const value = attributes[name];
        if (value === true)
            str += " " + name;
        else if (boolean_attributes.has(name.toLowerCase())) {
            if (value)
                str += " " + name;
        }
        else if (value != null) {
            str += ` ${name}="${String(value).replace(/"/g, '&#34;').replace(/'/g, '&#39;')}"`;
        }
    });
    return str;
}
const escaped = {
    '"': '&quot;',
    "'": '&#39;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
};
function escape(html) {
    return String(html).replace(/["'&<>]/g, match => escaped[match]);
}
function each(items, fn) {
    let str = '';
    for (let i = 0; i < items.length; i += 1) {
        str += fn(items[i], i);
    }
    return str;
}
const missing_component = {
    $$render: () => ''
};
function validate_component(component, name) {
    if (!component || !component.$$render) {
        if (name === 'svelte:component')
            name += ' this={...}';
        throw new Error(`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules`);
    }
    return component;
}
let on_destroy;
function create_ssr_component(fn) {
    function $$render(result, props, bindings, slots) {
        const parent_component = current_component;
        const $$ = {
            on_destroy,
            context: new Map(parent_component ? parent_component.$$.context : []),
            // these will be immediately discarded
            on_mount: [],
            before_update: [],
            after_update: [],
            callbacks: blank_object()
        };
        set_current_component({ $$ });
        const html = fn(result, props, bindings, slots);
        set_current_component(parent_component);
        return html;
    }
    return {
        render: (props = {}, options = {}) => {
            on_destroy = [];
            const result = { title: '', head: '', css: new Set() };
            const html = $$render(result, props, {}, options);
            run_all(on_destroy);
            return {
                html,
                css: {
                    code: Array.from(result.css).map(css => css.code).join('\n'),
                    map: null // TODO
                },
                head: result.title + result.head
            };
        },
        $$render
    };
}

const subscriber_queue = [];
/**
 * Creates a `Readable` store that allows reading by subscription.
 * @param value initial value
 * @param {StartStopNotifier}start start and stop notifications for subscriptions
 */
function readable(value, start) {
    return {
        subscribe: writable(value, start).subscribe,
    };
}
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}
function derived(stores, fn, initial_value) {
    const single = !Array.isArray(stores);
    const stores_array = single
        ? [stores]
        : stores;
    const auto = fn.length < 2;
    return readable(initial_value, (set) => {
        let inited = false;
        const values = [];
        let pending = 0;
        let cleanup = noop;
        const sync = () => {
            if (pending) {
                return;
            }
            cleanup();
            const result = fn(single ? values[0] : values, set);
            if (auto) {
                set(result);
            }
            else {
                cleanup = is_function(result) ? result : noop;
            }
        };
        const unsubscribers = stores_array.map((store, i) => store.subscribe((value) => {
            values[i] = value;
            pending &= ~(1 << i);
            if (inited) {
                sync();
            }
        }, () => {
            pending |= (1 << i);
        }));
        inited = true;
        sync();
        return function stop() {
            run_all(unsubscribers);
            cleanup();
        };
    });
}

const LOCATION = {};
const ROUTER = {};

/**
 * Adapted from https://github.com/reach/router/blob/b60e6dd781d5d3a4bdaaf4de665649c0f6a7e78d/src/lib/history.js
 *
 * https://github.com/reach/router/blob/master/LICENSE
 * */

function getLocation(source) {
  return {
    ...source.location,
    state: source.history.state,
    key: (source.history.state && source.history.state.key) || "initial"
  };
}

function createHistory(source, options) {
  const listeners = [];
  let location = getLocation(source);

  return {
    get location() {
      return location;
    },

    listen(listener) {
      listeners.push(listener);

      const popstateListener = () => {
        location = getLocation(source);
        listener({ location, action: "POP" });
      };

      source.addEventListener("popstate", popstateListener);

      return () => {
        source.removeEventListener("popstate", popstateListener);

        const index = listeners.indexOf(listener);
        listeners.splice(index, 1);
      };
    },

    navigate(to, { state, replace = false } = {}) {
      state = { ...state, key: Date.now() + "" };
      // try...catch iOS Safari limits to 100 pushState calls
      try {
        if (replace) {
          source.history.replaceState(state, null, to);
        } else {
          source.history.pushState(state, null, to);
        }
      } catch (e) {
        source.location[replace ? "replace" : "assign"](to);
      }

      location = getLocation(source);
      listeners.forEach(listener => listener({ location, action: "PUSH" }));
    }
  };
}

// Stores history entries in memory for testing or other platforms like Native
function createMemorySource(initialPathname = "/") {
  let index = 0;
  const stack = [{ pathname: initialPathname, search: "" }];
  const states = [];

  return {
    get location() {
      return stack[index];
    },
    addEventListener(name, fn) {},
    removeEventListener(name, fn) {},
    history: {
      get entries() {
        return stack;
      },
      get index() {
        return index;
      },
      get state() {
        return states[index];
      },
      pushState(state, _, uri) {
        const [pathname, search = ""] = uri.split("?");
        index++;
        stack.push({ pathname, search });
        states.push(state);
      },
      replaceState(state, _, uri) {
        const [pathname, search = ""] = uri.split("?");
        stack[index] = { pathname, search };
        states[index] = state;
      }
    }
  };
}

// Global history uses window.history as the source if available,
// otherwise a memory history
const canUseDOM = Boolean(
  typeof window !== "undefined" &&
    window.document &&
    window.document.createElement
);
const globalHistory = createHistory(canUseDOM ? window : createMemorySource());

/**
 * Adapted from https://github.com/reach/router/blob/b60e6dd781d5d3a4bdaaf4de665649c0f6a7e78d/src/lib/utils.js
 *
 * https://github.com/reach/router/blob/master/LICENSE
 * */

const paramRe = /^:(.+)/;

const SEGMENT_POINTS = 4;
const STATIC_POINTS = 3;
const DYNAMIC_POINTS = 2;
const SPLAT_PENALTY = 1;
const ROOT_POINTS = 1;

/**
 * Check if `string` starts with `search`
 * @param {string} string
 * @param {string} search
 * @return {boolean}
 */
function startsWith(string, search) {
  return string.substr(0, search.length) === search;
}

/**
 * Check if `segment` is a root segment
 * @param {string} segment
 * @return {boolean}
 */
function isRootSegment(segment) {
  return segment === "";
}

/**
 * Check if `segment` is a dynamic segment
 * @param {string} segment
 * @return {boolean}
 */
function isDynamic(segment) {
  return paramRe.test(segment);
}

/**
 * Check if `segment` is a splat
 * @param {string} segment
 * @return {boolean}
 */
function isSplat(segment) {
  return segment[0] === "*";
}

/**
 * Split up the URI into segments delimited by `/`
 * @param {string} uri
 * @return {string[]}
 */
function segmentize(uri) {
  return (
    uri
      // Strip starting/ending `/`
      .replace(/(^\/+|\/+$)/g, "")
      .split("/")
  );
}

/**
 * Strip `str` of potential start and end `/`
 * @param {string} str
 * @return {string}
 */
function stripSlashes(str) {
  return str.replace(/(^\/+|\/+$)/g, "");
}

/**
 * Score a route depending on how its individual segments look
 * @param {object} route
 * @param {number} index
 * @return {object}
 */
function rankRoute(route, index) {
  const score = route.default
    ? 0
    : segmentize(route.path).reduce((score, segment) => {
        score += SEGMENT_POINTS;

        if (isRootSegment(segment)) {
          score += ROOT_POINTS;
        } else if (isDynamic(segment)) {
          score += DYNAMIC_POINTS;
        } else if (isSplat(segment)) {
          score -= SEGMENT_POINTS + SPLAT_PENALTY;
        } else {
          score += STATIC_POINTS;
        }

        return score;
      }, 0);

  return { route, score, index };
}

/**
 * Give a score to all routes and sort them on that
 * @param {object[]} routes
 * @return {object[]}
 */
function rankRoutes(routes) {
  return (
    routes
      .map(rankRoute)
      // If two routes have the exact same score, we go by index instead
      .sort((a, b) =>
        a.score < b.score ? 1 : a.score > b.score ? -1 : a.index - b.index
      )
  );
}

/**
 * Ranks and picks the best route to match. Each segment gets the highest
 * amount of points, then the type of segment gets an additional amount of
 * points where
 *
 *  static > dynamic > splat > root
 *
 * This way we don't have to worry about the order of our routes, let the
 * computers do it.
 *
 * A route looks like this
 *
 *  { path, default, value }
 *
 * And a returned match looks like:
 *
 *  { route, params, uri }
 *
 * @param {object[]} routes
 * @param {string} uri
 * @return {?object}
 */
function pick(routes, uri) {
  let match;
  let default_;

  const [uriPathname] = uri.split("?");
  const uriSegments = segmentize(uriPathname);
  const isRootUri = uriSegments[0] === "";
  const ranked = rankRoutes(routes);

  for (let i = 0, l = ranked.length; i < l; i++) {
    const route = ranked[i].route;
    let missed = false;

    if (route.default) {
      default_ = {
        route,
        params: {},
        uri
      };
      continue;
    }

    const routeSegments = segmentize(route.path);
    const params = {};
    const max = Math.max(uriSegments.length, routeSegments.length);
    let index = 0;

    for (; index < max; index++) {
      const routeSegment = routeSegments[index];
      const uriSegment = uriSegments[index];

      if (routeSegment !== undefined && isSplat(routeSegment)) {
        // Hit a splat, just grab the rest, and return a match
        // uri:   /files/documents/work
        // route: /files/* or /files/*splatname
        const splatName = routeSegment === "*" ? "*" : routeSegment.slice(1);

        params[splatName] = uriSegments
          .slice(index)
          .map(decodeURIComponent)
          .join("/");
        break;
      }

      if (uriSegment === undefined) {
        // URI is shorter than the route, no match
        // uri:   /users
        // route: /users/:userId
        missed = true;
        break;
      }

      let dynamicMatch = paramRe.exec(routeSegment);

      if (dynamicMatch && !isRootUri) {
        const value = decodeURIComponent(uriSegment);
        params[dynamicMatch[1]] = value;
      } else if (routeSegment !== uriSegment) {
        // Current segments don't match, not dynamic, not splat, so no match
        // uri:   /users/123/settings
        // route: /users/:id/profile
        missed = true;
        break;
      }
    }

    if (!missed) {
      match = {
        route,
        params,
        uri: "/" + uriSegments.slice(0, index).join("/")
      };
      break;
    }
  }

  return match || default_ || null;
}

/**
 * Check if the `path` matches the `uri`.
 * @param {string} path
 * @param {string} uri
 * @return {?object}
 */
function match(route, uri) {
  return pick([route], uri);
}

/**
 * Add the query to the pathname if a query is given
 * @param {string} pathname
 * @param {string} [query]
 * @return {string}
 */
function addQuery(pathname, query) {
  return pathname + (query ? `?${query}` : "");
}

/**
 * Resolve URIs as though every path is a directory, no files. Relative URIs
 * in the browser can feel awkward because not only can you be "in a directory",
 * you can be "at a file", too. For example:
 *
 *  browserSpecResolve('foo', '/bar/') => /bar/foo
 *  browserSpecResolve('foo', '/bar') => /foo
 *
 * But on the command line of a file system, it's not as complicated. You can't
 * `cd` from a file, only directories. This way, links have to know less about
 * their current path. To go deeper you can do this:
 *
 *  <Link to="deeper"/>
 *  // instead of
 *  <Link to=`{${props.uri}/deeper}`/>
 *
 * Just like `cd`, if you want to go deeper from the command line, you do this:
 *
 *  cd deeper
 *  # not
 *  cd $(pwd)/deeper
 *
 * By treating every path as a directory, linking to relative paths should
 * require less contextual information and (fingers crossed) be more intuitive.
 * @param {string} to
 * @param {string} base
 * @return {string}
 */
function resolve(to, base) {
  // /foo/bar, /baz/qux => /foo/bar
  if (startsWith(to, "/")) {
    return to;
  }

  const [toPathname, toQuery] = to.split("?");
  const [basePathname] = base.split("?");
  const toSegments = segmentize(toPathname);
  const baseSegments = segmentize(basePathname);

  // ?a=b, /users?b=c => /users?a=b
  if (toSegments[0] === "") {
    return addQuery(basePathname, toQuery);
  }

  // profile, /users/789 => /users/789/profile
  if (!startsWith(toSegments[0], ".")) {
    const pathname = baseSegments.concat(toSegments).join("/");

    return addQuery((basePathname === "/" ? "" : "/") + pathname, toQuery);
  }

  // ./       , /users/123 => /users/123
  // ../      , /users/123 => /users
  // ../..    , /users/123 => /
  // ../../one, /a/b/c/d   => /a/b/one
  // .././one , /a/b/c/d   => /a/b/c/one
  const allSegments = baseSegments.concat(toSegments);
  const segments = [];

  allSegments.forEach(segment => {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== ".") {
      segments.push(segment);
    }
  });

  return addQuery("/" + segments.join("/"), toQuery);
}

/**
 * Combines the `basepath` and the `path` into one path.
 * @param {string} basepath
 * @param {string} path
 */
function combinePaths(basepath, path) {
  return `${stripSlashes(
    path === "/" ? basepath : `${stripSlashes(basepath)}/${stripSlashes(path)}`
  )}/`;
}

/* node_modules/svelte-routing/src/Router.svelte generated by Svelte v3.17.1 */

const Router = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let $base;
	let $location;
	let $routes;
	let { basepath = "/" } = $$props;
	let { url = null } = $$props;
	const locationContext = getContext(LOCATION);
	const routerContext = getContext(ROUTER);
	const routes = writable([]);
	$routes = get_store_value(routes);
	const activeRoute = writable(null);
	let hasActiveRoute = false;
	const location = locationContext || writable(url ? { pathname: url } : globalHistory.location);
	$location = get_store_value(location);

	const base = routerContext
	? routerContext.routerBase
	: writable({ path: basepath, uri: basepath });

	$base = get_store_value(base);

	const routerBase = derived([base, activeRoute], ([base, activeRoute]) => {
		if (activeRoute === null) {
			return base;
		}

		const { path: basepath } = base;
		const { route, uri } = activeRoute;

		const path = route.default
		? basepath
		: route.path.replace(/\*.*$/, "");

		return { path, uri };
	});

	function registerRoute(route) {
		const { path: basepath } = $base;
		let { path } = route;
		route._path = path;
		route.path = combinePaths(basepath, path);

		if (typeof window === "undefined") {
			if (hasActiveRoute) {
				return;
			}

			const matchingRoute = match(route, $location.pathname);

			if (matchingRoute) {
				activeRoute.set(matchingRoute);
				hasActiveRoute = true;
			}
		} else {
			routes.update(rs => {
				rs.push(route);
				return rs;
			});
		}
	}

	function unregisterRoute(route) {
		routes.update(rs => {
			const index = rs.indexOf(route);
			rs.splice(index, 1);
			return rs;
		});
	}

	if (!locationContext) {
		onMount(() => {
			const unlisten = globalHistory.listen(history => {
				location.set(history.location);
			});

			return unlisten;
		});

		setContext(LOCATION, location);
	}

	setContext(ROUTER, {
		activeRoute,
		base,
		routerBase,
		registerRoute,
		unregisterRoute
	});

	if ($$props.basepath === void 0 && $$bindings.basepath && basepath !== void 0) $$bindings.basepath(basepath);
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);
	$base = get_store_value(base);
	$location = get_store_value(location);
	$routes = get_store_value(routes);

	 {
		{
			const { path: basepath } = $base;

			routes.update(rs => {
				rs.forEach(r => r.path = combinePaths(basepath, r._path));
				return rs;
			});
		}
	}

	 {
		{
			const bestMatch = pick($routes, $location.pathname);
			activeRoute.set(bestMatch);
		}
	}

	return `${$$slots.default ? $$slots.default({}) : ``}`;
});

/* node_modules/svelte-routing/src/Route.svelte generated by Svelte v3.17.1 */

const Route = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let $activeRoute;
	let $location;
	let { path = "" } = $$props;
	let { component = null } = $$props;
	const { registerRoute, unregisterRoute, activeRoute } = getContext(ROUTER);
	$activeRoute = get_store_value(activeRoute);
	const location = getContext(LOCATION);
	$location = get_store_value(location);
	const route = { path, default: path === "" };
	let routeParams = {};
	let routeProps = {};
	registerRoute(route);

	if (typeof window !== "undefined") {
		onDestroy(() => {
			unregisterRoute(route);
		});
	}

	if ($$props.path === void 0 && $$bindings.path && path !== void 0) $$bindings.path(path);
	if ($$props.component === void 0 && $$bindings.component && component !== void 0) $$bindings.component(component);
	$activeRoute = get_store_value(activeRoute);
	$location = get_store_value(location);

	 {
		if ($activeRoute && $activeRoute.route === route) {
			routeParams = $activeRoute.params;
		}
	}

	 {
		{
			const { path, component, ...rest } = $$props;
			routeProps = rest;
		}
	}

	return `${$activeRoute !== null && $activeRoute.route === route
	? `${component !== null
		? `${validate_component(component || missing_component, "svelte:component").$$render($$result, Object.assign({ location: $location }, routeParams, routeProps), {}, {})}`
		: `${$$slots.default
			? $$slots.default({ params: routeParams, location: $location })
			: ``}`}`
	: ``}`;
});

/* node_modules/svelte-routing/src/Link.svelte generated by Svelte v3.17.1 */

const Link = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let $base;
	let $location;
	let { to = "#" } = $$props;
	let { replace = false } = $$props;
	let { state = {} } = $$props;
	let { getProps = () => ({}) } = $$props;
	const { base } = getContext(ROUTER);
	$base = get_store_value(base);
	const location = getContext(LOCATION);
	$location = get_store_value(location);
	const dispatch = createEventDispatcher();
	let href, isPartiallyCurrent, isCurrent, props;

	if ($$props.to === void 0 && $$bindings.to && to !== void 0) $$bindings.to(to);
	if ($$props.replace === void 0 && $$bindings.replace && replace !== void 0) $$bindings.replace(replace);
	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	if ($$props.getProps === void 0 && $$bindings.getProps && getProps !== void 0) $$bindings.getProps(getProps);
	$base = get_store_value(base);
	$location = get_store_value(location);
	href = to === "/" ? $base.uri : resolve(to, $base.uri);
	isPartiallyCurrent = startsWith($location.pathname, href);
	isCurrent = href === $location.pathname;
	let ariaCurrent = isCurrent ? "page" : undefined;

	props = getProps({
		location: $location,
		href,
		isPartiallyCurrent,
		isCurrent
	});

	return `<a${spread([{ href: escape(href) }, { "aria-current": escape(ariaCurrent) }, props])}>
  ${$$slots.default ? $$slots.default({}) : ``}
</a>`;
});

/* src/components/NavLink.svelte generated by Svelte v3.17.1 */

const css = {
	code: ".link a{font-weight:600;font-size:18px;text-decoration:none !important;color:#3c3c3c}.link.svelte-hfz0be{margin:2px 0}",
	map: "{\"version\":3,\"file\":\"NavLink.svelte\",\"sources\":[\"NavLink.svelte\"],\"sourcesContent\":[\"<script>\\n  import { Link } from \\\"svelte-routing\\\";\\n\\n  export let to = \\\"\\\";\\n\\n  function getProps({ location, href, isPartiallyCurrent, isCurrent }) {\\n    const isActive = href === \\\"/\\\" ? isCurrent : isPartiallyCurrent || isCurrent;\\n\\n    // The object returned here is spread on the anchor element's attributes\\n    if (isActive) {\\n      return { class: \\\"active\\\" };\\n    }\\n    return {};\\n  }\\n</script>\\n\\n<style>\\n  :global(.link a) {\\n    font-weight: 600;\\n    font-size: 18px;\\n    text-decoration: none !important;\\n    color: #3c3c3c;\\n  }\\n  .link {\\n    margin: 2px 0;\\n  }\\n</style>\\n\\n<div class=\\\"link\\\">\\n  <Link {to} {getProps}>\\n    <slot />\\n  </Link>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAiBU,OAAO,AAAE,CAAC,AAChB,WAAW,CAAE,GAAG,CAChB,SAAS,CAAE,IAAI,CACf,eAAe,CAAE,IAAI,CAAC,UAAU,CAChC,KAAK,CAAE,OAAO,AAChB,CAAC,AACD,KAAK,cAAC,CAAC,AACL,MAAM,CAAE,GAAG,CAAC,CAAC,AACf,CAAC\"}"
};

function getProps({ location, href, isPartiallyCurrent, isCurrent }) {
	const isActive = href === "/"
	? isCurrent
	: isPartiallyCurrent || isCurrent;

	if (isActive) {
		return { class: "active" };
	}

	return {};
}

const NavLink = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { to = "" } = $$props;
	if ($$props.to === void 0 && $$bindings.to && to !== void 0) $$bindings.to(to);
	$$result.css.add(css);

	return `<div class="${"link svelte-hfz0be"}">
  ${validate_component(Link, "Link").$$render($$result, { to, getProps }, {}, {
		default: () => `
    ${$$slots.default ? $$slots.default({}) : ``}
  `
	})}
</div>`;
});

/* src/routes/Nav.svelte generated by Svelte v3.17.1 */

const css$1 = {
	code: ".sidebar.svelte-1iz2jkn{display:flex;flex-direction:column;margin-top:4vw}",
	map: "{\"version\":3,\"file\":\"Nav.svelte\",\"sources\":[\"Nav.svelte\"],\"sourcesContent\":[\"<script>\\n  import NavLink from \\\"components/NavLink.svelte\\\";\\n</script>\\n\\n<style>\\n  .sidebar {\\n    display: flex;\\n    flex-direction: column;\\n    margin-top: 4vw;\\n  }\\n</style>\\n\\n<div class=\\\"sidebar\\\">\\n  <NavLink to=\\\"blog\\\">Writings</NavLink>\\n  <NavLink to=\\\"/\\\">Home</NavLink>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAKE,QAAQ,eAAC,CAAC,AACR,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,UAAU,CAAE,GAAG,AACjB,CAAC\"}"
};

const Nav = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	$$result.css.add(css$1);

	return `<div class="${"sidebar svelte-1iz2jkn"}">
  ${validate_component(NavLink, "NavLink").$$render($$result, { to: "blog" }, {}, { default: () => `Writings` })}
  ${validate_component(NavLink, "NavLink").$$render($$result, { to: "/" }, {}, { default: () => `Home` })}
</div>`;
});

/* src/components/List.svelte generated by Svelte v3.17.1 */

const css$2 = {
	code: ".list.svelte-1hnkl9k h3.svelte-1hnkl9k{font-size:1.5em;font-weight:700;font-variant:small-caps;margin-top:4px;line-height:1.125}.list li{line-height:1.55}.list a, .list p{color:#333}.list a:hover{color:#888}",
	map: "{\"version\":3,\"file\":\"List.svelte\",\"sources\":[\"List.svelte\"],\"sourcesContent\":[\"<script>\\n  export let title;\\n</script>\\n\\n<style>\\n  .list h3 {\\n    font-size: 1.5em;\\n    font-weight: 700;\\n    font-variant: small-caps;\\n    margin-top: 4px;\\n    line-height: 1.125;\\n  }\\n\\n  :global(.list li) {\\n    line-height: 1.55;\\n  }\\n\\n  :global(.list a, .list p) {\\n    color: #333;\\n  }\\n  :global(.list a:hover) {\\n    color: #888;\\n  }\\n</style>\\n\\n<div class=\\\"list\\\">\\n  <h3>{title}</h3>\\n  <ul>\\n    <slot />\\n  </ul>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAKE,oBAAK,CAAC,EAAE,eAAC,CAAC,AACR,SAAS,CAAE,KAAK,CAChB,WAAW,CAAE,GAAG,CAChB,YAAY,CAAE,UAAU,CACxB,UAAU,CAAE,GAAG,CACf,WAAW,CAAE,KAAK,AACpB,CAAC,AAEO,QAAQ,AAAE,CAAC,AACjB,WAAW,CAAE,IAAI,AACnB,CAAC,AAEO,gBAAgB,AAAE,CAAC,AACzB,KAAK,CAAE,IAAI,AACb,CAAC,AACO,aAAa,AAAE,CAAC,AACtB,KAAK,CAAE,IAAI,AACb,CAAC\"}"
};

const List = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { title } = $$props;
	if ($$props.title === void 0 && $$bindings.title && title !== void 0) $$bindings.title(title);
	$$result.css.add(css$2);

	return `<div class="${"list svelte-1hnkl9k"}">
  <h3 class="${"svelte-1hnkl9k"}">${escape(title)}</h3>
  <ul>
    ${$$slots.default ? $$slots.default({}) : ``}
  </ul>
</div>`;
});

/* src/routes/Blog.svelte generated by Svelte v3.17.1 */

const css$3 = {
	code: ".container.svelte-o561e7{width:100%;padding:0 20px;margin-left:30px;margin-top:4vw}.posts.svelte-o561e7{display:flex;flex-wrap:wrap;margin-top:2vw}",
	map: "{\"version\":3,\"file\":\"Blog.svelte\",\"sources\":[\"Blog.svelte\"],\"sourcesContent\":[\"<script>\\n  import { Router, Link, Route } from \\\"svelte-routing\\\";\\n  import List from \\\"components/List.svelte\\\";\\n\\n  const posts = [\\n    {\\n      tags: [\\\"lifestyle\\\"],\\n      slug: \\\"lifestyle-post-1\\\",\\n      title: \\\"How to live\\\",\\n      content: \\\"just do it\\\"\\n    },\\n    {\\n      tags: [\\\"lifestyle\\\"],\\n      slug: \\\"lifestyle-post-2\\\",\\n      title: \\\"How to live p. 2\\\",\\n      content: \\\"keep doing it\\\"\\n    },\\n    {\\n      tags: [\\\"lifestyle\\\"],\\n      slug: \\\"lifestyle-post-3\\\",\\n      title: \\\"How to live p. 3\\\",\\n      content: \\\"can't stop won't stop doing it\\\"\\n    },\\n    {\\n      tags: [\\\"technical\\\"],\\n      slug: \\\"technical-post-1\\\",\\n      title: \\\"How computers work\\\",\\n      content: \\\"magic i guess\\\"\\n    },\\n    {\\n      tags: [\\\"technical\\\"],\\n      slug: \\\"technical-post-2\\\",\\n      title: \\\"How computers work p. 2\\\",\\n      content: \\\"ask siri\\\"\\n    }\\n  ];\\n</script>\\n\\n<style>\\n  .container {\\n    width: 100%;\\n    padding: 0 20px;\\n    margin-left: 30px;\\n    margin-top: 4vw;\\n  }\\n  .posts {\\n    display: flex;\\n    flex-wrap: wrap;\\n    margin-top: 2vw;\\n  }\\n</style>\\n\\n<svelte:head>\\n  <title>Writings | Sibtain Jafferi</title>\\n</svelte:head>\\n\\n<div class=\\\"container\\\">\\n\\n  <Router>\\n    <Route path=\\\"/\\\">\\n      <div class=\\\"posts\\\">\\n        <List title=\\\"Lifestyle\\\">\\n          {#each posts as post}\\n            {#if post.tags.includes('lifestyle')}\\n              <li>\\n                <Link to={post.slug}>{post.title}</Link>\\n              </li>\\n            {/if}\\n          {/each}\\n        </List>\\n\\n        <List title=\\\"Technical\\\">\\n          {#each posts as post}\\n            {#if post.tags.includes('technical')}\\n              <li>\\n                <Link to={post.slug}>{post.title}</Link>\\n              </li>\\n            {/if}\\n          {/each}\\n        </List>\\n      </div>\\n    </Route>\\n\\n    {#each posts as post}\\n      <Route path={post.slug}>\\n        <div class=\\\"post\\\">\\n          <h2>{post.title}</h2>\\n          <p>{post.content}</p>\\n        </div>\\n      </Route>\\n    {/each}\\n  </Router>\\n\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAuCE,UAAU,cAAC,CAAC,AACV,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,CAAC,CAAC,IAAI,CACf,WAAW,CAAE,IAAI,CACjB,UAAU,CAAE,GAAG,AACjB,CAAC,AACD,MAAM,cAAC,CAAC,AACN,OAAO,CAAE,IAAI,CACb,SAAS,CAAE,IAAI,CACf,UAAU,CAAE,GAAG,AACjB,CAAC\"}"
};

const Blog = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	const posts = [
		{
			tags: ["lifestyle"],
			slug: "lifestyle-post-1",
			title: "How to live",
			content: "just do it"
		},
		{
			tags: ["lifestyle"],
			slug: "lifestyle-post-2",
			title: "How to live p. 2",
			content: "keep doing it"
		},
		{
			tags: ["lifestyle"],
			slug: "lifestyle-post-3",
			title: "How to live p. 3",
			content: "can't stop won't stop doing it"
		},
		{
			tags: ["technical"],
			slug: "technical-post-1",
			title: "How computers work",
			content: "magic i guess"
		},
		{
			tags: ["technical"],
			slug: "technical-post-2",
			title: "How computers work p. 2",
			content: "ask siri"
		}
	];

	$$result.css.add(css$3);

	return `${($$result.head += `${($$result.title = `<title>Writings | Sibtain Jafferi</title>`, "")}`, "")}

<div class="${"container svelte-o561e7"}">

  ${validate_component(Router, "Router").$$render($$result, {}, {}, {
		default: () => `
    ${validate_component(Route, "Route").$$render($$result, { path: "/" }, {}, {
			default: () => `
      <div class="${"posts svelte-o561e7"}">
        ${validate_component(List, "List").$$render($$result, { title: "Lifestyle" }, {}, {
				default: () => `
          ${each(posts, post => `${post.tags.includes("lifestyle")
				? `<li>
                ${validate_component(Link, "Link").$$render($$result, { to: post.slug }, {}, { default: () => `${escape(post.title)}` })}
              </li>`
				: ``}`)}
        `
			})}

        ${validate_component(List, "List").$$render($$result, { title: "Technical" }, {}, {
				default: () => `
          ${each(posts, post => `${post.tags.includes("technical")
				? `<li>
                ${validate_component(Link, "Link").$$render($$result, { to: post.slug }, {}, { default: () => `${escape(post.title)}` })}
              </li>`
				: ``}`)}
        `
			})}
      </div>
    `
		})}

    ${each(posts, post => `${validate_component(Route, "Route").$$render($$result, { path: post.slug }, {}, {
			default: () => `
        <div class="${"post"}">
          <h2>${escape(post.title)}</h2>
          <p>${escape(post.content)}</p>
        </div>
      `
		})}`)}
  `
	})}

</div>`;
});

/* src/routes/Home.svelte generated by Svelte v3.17.1 */

const css$4 = {
	code: ".home.svelte-4h3dcq{margin-left:30px;margin-top:4vw}",
	map: "{\"version\":3,\"file\":\"Home.svelte\",\"sources\":[\"Home.svelte\"],\"sourcesContent\":[\"<style>\\n  .home {\\n    margin-left: 30px;\\n    margin-top: 4vw;\\n  }\\n</style>\\n\\n<div class=\\\"home\\\">\\n  <h3>Welcome home</h3>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AACE,KAAK,cAAC,CAAC,AACL,WAAW,CAAE,IAAI,CACjB,UAAU,CAAE,GAAG,AACjB,CAAC\"}"
};

const Home = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	$$result.css.add(css$4);

	return `<div class="${"home svelte-4h3dcq"}">
  <h3>Welcome home</h3>
</div>`;
});

/* src/App.svelte generated by Svelte v3.17.1 */

const css$5 = {
	code: ".container.svelte-rfw4x3{max-width:110ch;margin:auto;padding:0 20px;display:flex}.page.svelte-rfw4x3{width:100%}",
	map: "{\"version\":3,\"file\":\"App.svelte\",\"sources\":[\"App.svelte\"],\"sourcesContent\":[\"<script>\\n  import { Router, Route } from \\\"svelte-routing\\\";\\n  import Nav from \\\"routes/Nav.svelte\\\";\\n  import Blog from \\\"routes/Blog.svelte\\\";\\n  import Home from \\\"routes/Home.svelte\\\";\\n\\n  // Used for SSR. A falsy value is ignored by the Router.\\n  export let url = \\\"\\\";\\n</script>\\n\\n<style>\\n  .container {\\n    max-width: 110ch;\\n    margin: auto;\\n    padding: 0 20px;\\n    display: flex;\\n  }\\n\\n  .page {\\n    width: 100%;\\n  }\\n</style>\\n\\n<div class=\\\"container\\\">\\n  <Router {url}>\\n    <Nav />\\n    <div class=\\\"page\\\">\\n      <Route path=\\\"/\\\" component={Home} />\\n      <Route path=\\\"blog/*\\\" component={Blog} />\\n    </div>\\n  </Router>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAWE,UAAU,cAAC,CAAC,AACV,SAAS,CAAE,KAAK,CAChB,MAAM,CAAE,IAAI,CACZ,OAAO,CAAE,CAAC,CAAC,IAAI,CACf,OAAO,CAAE,IAAI,AACf,CAAC,AAED,KAAK,cAAC,CAAC,AACL,KAAK,CAAE,IAAI,AACb,CAAC\"}"
};

const App = create_ssr_component(($$result, $$props, $$bindings, $$slots) => {
	let { url = "" } = $$props;
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);
	$$result.css.add(css$5);

	return `<div class="${"container svelte-rfw4x3"}">
  ${validate_component(Router, "Router").$$render($$result, { url }, {}, {
		default: () => `
    ${validate_component(Nav, "Nav").$$render($$result, {}, {}, {})}
    <div class="${"page svelte-rfw4x3"}">
      ${validate_component(Route, "Route").$$render($$result, { path: "/", component: Home }, {}, {})}
      ${validate_component(Route, "Route").$$render($$result, { path: "blog/*", component: Blog }, {}, {})}
    </div>
  `
	})}
</div>`;
});

module.exports = App;
