<script>
  import NavLink from "components/NavLink.svelte";
</script>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    margin-top: 4vw;
  }
</style>

<div class="sidebar">
  <NavLink to="blog">Writings</NavLink>
  <NavLink to="/">Home</NavLink>
</div>
