package web

import (
	"net/http"
)

type Route struct {
	Method  string
	Path    string
	Handler http.HandlerFunc
}

// methodMap dispatches multiple methods on the same path.
type methodMap map[string]http.HandlerFunc

type Router struct {
	mux         *http.ServeMux
	routes      []Route
	pathMethods map[string]methodMap // path → method → handler
}

func NewRouter() *Router {
	return &Router{
		mux:         http.NewServeMux(),
		pathMethods: make(map[string]methodMap),
	}
}

func (rt *Router) Handle(method, path string, handler http.HandlerFunc) {
	rt.routes = append(rt.routes, Route{Method: method, Path: path, Handler: handler})

	// wildcard method: register directly
	if method == "*" {
		rt.mux.HandleFunc(path, handler)
		return
	}

	mm, exists := rt.pathMethods[path]
	if !exists {
		mm = make(methodMap)
		rt.pathMethods[path] = mm
		// first registration for this path: create dispatch func
		rt.mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if h, ok := rt.pathMethods[path][r.Method]; ok {
				h(w, r)
				return
			}
			Fail(w, r, "SYSTEM_METHOD_NOT_ALLOWED", "method not allowed", http.StatusMethodNotAllowed)
		})
	}
	mm[method] = handler
}

func (rt *Router) GET(path string, handler http.HandlerFunc) {
	rt.Handle(http.MethodGet, path, handler)
}
func (rt *Router) POST(path string, handler http.HandlerFunc) {
	rt.Handle(http.MethodPost, path, handler)
}
func (rt *Router) PUT(path string, handler http.HandlerFunc) {
	rt.Handle(http.MethodPut, path, handler)
}
func (rt *Router) DELETE(path string, handler http.HandlerFunc) {
	rt.Handle(http.MethodDelete, path, handler)
}

func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rt.mux.ServeHTTP(w, r)
}
