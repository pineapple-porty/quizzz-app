# Quiz App

Plain HTML, CSS, and JavaScript served by an Express 5 server, with PostgreSQL
access through `pg`.

## Run

```sh
npm run dev
```

The server listens on port `5000` and serves the app from `public/`.

## Health endpoints

- `GET /api/health` checks that the server is responding.
- `GET /api/health/database` runs a PostgreSQL connectivity check.

The PostgreSQL pool uses Replit's `DATABASE_URL` or standard `PG*` environment
variables. Database queries that include values should use `pg` parameter
placeholders (for example, `pool.query("SELECT ... WHERE id = $1", [id])`).
