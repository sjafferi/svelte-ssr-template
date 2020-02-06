const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const fs = require('fs');
const app = require("./public/App.js");

const server = express();
server.use(bodyParser.json({ limit: "10mb" }));
server.use(express.static(path.join(__dirname, "public")));

server.post('/get-post', function (req, res) {
  const path = `${__dirname}/posts/${req.body.slug}.md`;
  const file = fs.readFileSync(path, 'utf8');
  res.send({ post: file.toString() });
});

server.get("*", function (req, res) {
  const { html } = app.render({ url: req.url });
  res.write(`
    <!DOCTYPE html>
    <link rel='stylesheet' href='/global.css'>
    <link rel='stylesheet' href='/bundle.css'>
    <div id="app">${html}</div>
    <script src="/bundle.js"></script>
  `);

  res.end();
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Listening on port ${port}`));
