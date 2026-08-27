# Edge Scripting

This one deploys rather than running on your machine.

```bash
npm install
bunny scripts create notes-api
bunny scripts env set BUNNY_DATABASE_URL "libsql://your-database.lite.bunnydb.net"
bunny scripts env set BUNNY_DATABASE_AUTH_TOKEN "your-token" --secret
npm start
```

`npm start` is `bunny scripts deploy main.ts`, using the CLI that `npm install` just put in this directory. There is no `.env` here: the variables live on the script, which is what `scripts env set` writes.

Full CRUD once it is live: `GET`/`POST` on `/notes`, `GET`/`PUT`/`DELETE` on `/notes/:id`.
