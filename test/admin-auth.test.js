const assert = require("node:assert/strict");
const { createHash, scryptSync } = require("node:crypto");
const { once } = require("node:events");
const express = require("express");
const { test } = require("node:test");
const models = require("../models");
const routes = require("../routes");

function replaceMethod(t, target, method, replacement) {
  const original = target[method];
  target[method] = replacement;
  t.after(() => {
    target[method] = original;
  });
}

function queryResult(value) {
  return {
    select() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

async function createApi(t) {
  const app = express();
  app.use(express.json());
  app.use("/api", routes);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}/api`;
}

test("admin reads and writes require an authenticated session", async (t) => {
  const api = await createApi(t);
  const requests = [
    fetch(`${api}/subscribers`),
    fetch(`${api}/submissions`),
    fetch(`${api}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Unauthorized write" }),
    }),
    fetch(`${api}/projects/665f10000000000000000001`, {
      method: "DELETE",
    }),
  ];

  const responses = await Promise.all(requests);
  assert.deepEqual(
    responses.map((response) => response.status),
    [401, 401, 401, 401]
  );
  assert.equal((await fetch(`${api}/admin/credentials`)).status, 404);
});

test("public application submissions remain available without admin auth", async (t) => {
  replaceMethod(t, models.Submission.prototype, "save", async function save() {
    return this;
  });

  const api = await createApi(t);
  const response = await fetch(`${api}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "career", name: "Applicant" }),
  });

  assert.equal(response.status, 201);
});

test("admin login issues a token accepted by protected routes and logout revokes it", async (t) => {
  const password = "StrongPass1!";
  const salt = "00112233445566778899aabbccddeeff";
  const config = {
    _id: "admin-config-id",
    key: "admin_credentials",
    username: "admin",
    passwordHash: scryptSync(password, salt, 64).toString("hex"),
    passwordSalt: salt,
    sessionTokenHash: undefined,
    sessionExpiresAt: undefined,
    async save() {
      return this;
    },
  };
  replaceMethod(t, models.AdminConfig, "findOne", (filter) => {
    if (filter.sessionTokenHash) {
      const sessionMatches = filter.sessionTokenHash === config.sessionTokenHash;
      const sessionIsActive =
        config.sessionExpiresAt && config.sessionExpiresAt > new Date();
      return queryResult(sessionMatches && sessionIsActive ? config : null);
    }
    return queryResult(config);
  });
  replaceMethod(t, models.AdminConfig, "updateOne", async (_filter, update) => {
    if (update.$unset.sessionTokenHash) config.sessionTokenHash = undefined;
    if (update.$unset.sessionExpiresAt) config.sessionExpiresAt = undefined;
    return { modifiedCount: 1 };
  });

  const api = await createApi(t);
  const loginResponse = await fetch(`${api}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  const login = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(login.success, true);
  assert.match(login.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    config.sessionTokenHash,
    createHash("sha256").update(login.token).digest("hex")
  );

  const logoutResponse = await fetch(`${api}/admin/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.equal(logoutResponse.status, 200);
  assert.equal(config.sessionTokenHash, undefined);
});

test("legacy plaintext passwords are replaced by the configured initial password", async (t) => {
  const legacyPassword = "LegacyPass1!";
  const initialPassword = "MigrationPass2@";
  const originalInitialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  process.env.ADMIN_INITIAL_PASSWORD = initialPassword;
  t.after(() => {
    if (originalInitialPassword === undefined) {
      delete process.env.ADMIN_INITIAL_PASSWORD;
    } else {
      process.env.ADMIN_INITIAL_PASSWORD = originalInitialPassword;
    }
  });
  const config = {
    key: "admin_credentials",
    username: "admin",
    password: legacyPassword,
    async save() {
      return this;
    },
  };
  replaceMethod(t, models.AdminConfig, "findOne", () => queryResult(config));

  const api = await createApi(t);
  const response = await fetch(`${api}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: initialPassword }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(config.password, undefined);
  assert.equal(config.passwordSalt.length, 32);
  assert.equal(config.passwordHash.length, 128);
  assert.notEqual(config.passwordHash, legacyPassword);
});

test("changing the admin password invalidates the current session", async (t) => {
  const currentPassword = "StrongPass1!";
  const salt = "ffeeddccbbaa99887766554433221100";
  const config = {
    _id: "admin-config-id",
    key: "admin_credentials",
    username: "admin",
    passwordHash: scryptSync(currentPassword, salt, 64).toString("hex"),
    passwordSalt: salt,
    async save() {
      return this;
    },
  };
  replaceMethod(t, models.AdminConfig, "findOne", (filter) => {
    if (filter.sessionTokenHash) {
      const sessionMatches = filter.sessionTokenHash === config.sessionTokenHash;
      const sessionIsActive =
        config.sessionExpiresAt && config.sessionExpiresAt > new Date();
      return queryResult(sessionMatches && sessionIsActive ? config : null);
    }
    return queryResult(config);
  });

  const api = await createApi(t);
  const loginResponse = await fetch(`${api}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: currentPassword }),
  });
  const { token } = await loginResponse.json();
  const oldPasswordHash = config.passwordHash;
  const changeResponse = await fetch(`${api}/admin/change-password`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      currentPassword,
      newPassword: "AnotherPass2@",
    }),
  });

  assert.equal(changeResponse.status, 200);
  assert.notEqual(config.passwordHash, oldPasswordHash);
  assert.equal(config.sessionTokenHash, undefined);

  const staleSessionResponse = await fetch(`${api}/subscribers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(staleSessionResponse.status, 401);
});
