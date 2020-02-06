<script>
  import { Router, Link, Route } from "svelte-routing";
  import List from "components/List.svelte";

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
</script>

<style>
  .container {
    width: 100%;
    padding: 0 20px;
    margin-left: 30px;
    margin-top: 4vw;
  }
  .posts {
    display: flex;
    flex-wrap: wrap;
    margin-top: 2vw;
  }
</style>

<svelte:head>
  <title>Writings | Sibtain Jafferi</title>
</svelte:head>

<div class="container">

  <Router>
    <Route path="/">
      <div class="posts">
        <List title="Lifestyle">
          {#each posts as post}
            {#if post.tags.includes('lifestyle')}
              <li>
                <Link to={post.slug}>{post.title}</Link>
              </li>
            {/if}
          {/each}
        </List>

        <List title="Technical">
          {#each posts as post}
            {#if post.tags.includes('technical')}
              <li>
                <Link to={post.slug}>{post.title}</Link>
              </li>
            {/if}
          {/each}
        </List>
      </div>
    </Route>

    {#each posts as post}
      <Route path={post.slug}>
        <div class="post">
          <h2>{post.title}</h2>
          <p>{post.content}</p>
        </div>
      </Route>
    {/each}
  </Router>

</div>
