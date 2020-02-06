<script>
  import { Router, Route } from "svelte-routing";
  import Nav from "routes/Nav.svelte";
  import Blog from "routes/Blog.svelte";
  import Home from "routes/Home.svelte";

  // Used for SSR. A falsy value is ignored by the Router.
  export let url = "";
</script>

<style>
  .container {
    max-width: 110ch;
    margin: auto;
    padding: 0 20px;
    display: flex;
  }

  .page {
    width: 100%;
  }
</style>

<div class="container">
  <Router {url}>
    <Nav />
    <div class="page">
      <Route path="/" component={Home} />
      <Route path="blog/*" component={Blog} />
    </div>
  </Router>
</div>
