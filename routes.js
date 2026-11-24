const express = require("express");
const router = express.Router();
const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const models = require("./models");
const mongoose = models.mongoose;
const scrypt = promisify(scryptCallback);

const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=30, must-revalidate";
const PUBLICATION_FILTER = { published: { $ne: false } };
const ADMIN_CONFIG_KEY = "admin_credentials";
const PASSWORD_HASH_BYTES = 64;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PUBLIC_CACHE_COLLECTIONS = new Set([
  "/projects",
  "/campaigns",
  "/events",
  "/trainings",
  "/publications",
  "/partners",
  "/metrics",
  "/recommendations",
  "/hero-slides",
]);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isStrongPassword(password) {
  if (typeof password !== "string" || password.length < 8) return false;
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  ];
  return checks.filter(Boolean).length >= 4;
}

async function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, PASSWORD_HASH_BYTES);
  return { salt, hash: hash.toString("hex") };
}

async function verifyPassword(password, config) {
  if (
    typeof password !== "string" ||
    !config.passwordHash ||
    !config.passwordSalt
  ) {
    return false;
  }
  const expected = Buffer.from(config.passwordHash, "hex");
  if (expected.length !== PASSWORD_HASH_BYTES) return false;
  const actual = await scrypt(password, config.passwordSalt, PASSWORD_HASH_BYTES);
  return timingSafeEqual(actual, expected);
}

async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) {
    return res.status(401).json({ error: "Admin authentication required" });
  }

  try {
    const config = await models.AdminConfig.findOne({
      key: ADMIN_CONFIG_KEY,
      sessionTokenHash: hashToken(match[1]),
      sessionExpiresAt: { $gt: new Date() },
    }).select("+passwordHash +passwordSalt");
    if (!config) {
      return res.status(401).json({ error: "Admin session is invalid or expired" });
    }
    req.adminConfig = config;
    return next();
  } catch (error) {
    console.error(`Admin authorization failed: ${error.message}`);
    return res.status(503).json({ error: "Admin authorization is temporarily unavailable" });
  }
}

function publicFilter(filter = {}) {
  return { ...filter, ...PUBLICATION_FILTER };
}

function publicItem(item) {
  if (!item) return item;
  return { ...item, id: String(item._id || item.id) };
}

function setPublicCacheHeaders(res) {
  res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
}

async function revalidateFrontend(collection, res) {
  if (!PUBLIC_CACHE_COLLECTIONS.has(collection)) return;

  const url = process.env.FRONTEND_REVALIDATION_URL;
  const secret = process.env.FRONTEND_REVALIDATION_SECRET;
  if (!url || !secret) {
    console.warn(
      `Cache revalidation is not configured for ${collection}; relying on the bounded cache TTL`
    );
    res.setHeader("X-Breat-Cache-Revalidation", "ttl-fallback");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ collections: [collection] }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`frontend revalidation returned HTTP ${response.status}`);
    }
    res.setHeader("X-Breat-Cache-Revalidation", "complete");
  } catch (error) {
    console.error(
      `Cache revalidation failed for ${collection}; relying on the bounded cache TTL: ${error.message}`
    );
    res.setHeader("X-Breat-Cache-Revalidation", "ttl-fallback");
  } finally {
    clearTimeout(timeout);
  }
}

function homepageFacet(Model, itemStages, includeCount = true) {
  const facets = { items: itemStages };
  if (includeCount) facets.count = [{ $count: "total" }];
  return Model.aggregate([
    { $match: PUBLICATION_FILTER },
    { $facet: facets },
  ])
    .option({ maxTimeMS: 2000 })
    .exec()
    .then(([result]) => ({
      items: (result?.items || []).map(publicItem),
      total: result?.count?.[0]?.total ?? 0,
    }));
}

async function readHomepageSection(name, load) {
  try {
    return { name, value: await load() };
  } catch (error) {
    console.error(`GET /homepage ${name} section failed: ${error.message}`);
    return { name, error };
  }
}

router.get("/homepage/hero", async (req, res) => {
  setPublicCacheHeaders(res);
  try {
    const slides = await models.HeroSlide.find({
      ...PUBLICATION_FILTER,
      image: { $type: "string", $ne: "" },
    })
      .select("_id title subtitle image order")
      .sort({ order: 1, _id: -1 })
      .limit(5)
      .maxTimeMS(1500)
      .lean()
      .exec();
    return res.json({ slides: slides.map(publicItem) });
  } catch (error) {
    console.error(`GET /homepage/hero error: ${error.message}`);
    return res.status(503).json({ error: "Hero content is temporarily unavailable" });
  }
});

router.get("/homepage", async (req, res) => {
  setPublicCacheHeaders(res);
  const summaries = {
    projects: [
      { $sort: { _id: -1 } },
      { $limit: 4 },
      {
        $project: {
          _id: 1,
          title: 1,
          category: 1,
          status: 1,
          image: 1,
          location: 1,
          shortDescription: {
            $substrCP: [{ $ifNull: ["$shortDescription", ""] }, 0, 240],
          },
        },
      },
    ],
    campaigns: [
      { $sort: { _id: -1 } },
      { $limit: 4 },
      {
        $project: {
          _id: 1,
          title: 1,
          category: 1,
          status: 1,
          image: 1,
          shortDescription: {
            $substrCP: [{ $ifNull: ["$shortDescription", ""] }, 0, 240],
          },
        },
      },
    ],
    events: [
      { $match: { type: "Upcoming" } },
      { $sort: { _id: -1 } },
      { $limit: 4 },
      {
        $project: {
          _id: 1,
          title: 1,
          type: 1,
          date: 1,
          location: 1,
          image: 1,
          description: {
            $substrCP: [{ $ifNull: ["$shortDescription", ""] }, 0, 240],
          },
        },
      },
    ],
    trainings: [
      { $sort: { _id: -1 } },
      { $limit: 4 },
      {
        $project: {
          _id: 1,
          title: 1,
          category: 1,
          status: 1,
          type: 1,
          image: 1,
          shortDescription: {
            $substrCP: [{ $ifNull: ["$shortDescription", ""] }, 0, 240],
          },
        },
      },
    ],
    stories: [
      { $match: { type: "stories" } },
      { $sort: { _id: -1 } },
      { $limit: 4 },
      {
        $project: {
          _id: 1,
          title: 1,
          date: 1,
          location: 1,
          image: 1,
          excerpt: {
            $substrCP: [
              { $ifNull: ["$excerpt", { $ifNull: ["$summary", ""] }] },
              0,
              240,
            ],
          },
        },
      },
    ],
    partners: [
      { $sort: { _id: -1 } },
      { $limit: 8 },
      {
        $project: {
          _id: 1,
          name: 1,
          type: 1,
          logoText: 1,
          image: 1,
          logoUrl: 1,
          logo: 1,
          link: 1,
          driveLink: 1,
        },
      },
    ],
    recommendations: [
      { $sort: { _id: -1 } },
      { $limit: 6 },
      {
        $project: {
          _id: 1,
          title: 1,
          author: 1,
          position: 1,
          organization: 1,
          image: 1,
          featured: 1,
          isFeatured: 1,
          quote: { $substrCP: [{ $ifNull: ["$quote", ""] }, 0, 600] },
        },
      },
    ],
  };
  const sections = [
    {
      name: "projects",
      count: "projects",
      load: () => homepageFacet(models.Project, summaries.projects),
    },
    {
      name: "campaigns",
      count: "campaigns",
      load: () => homepageFacet(models.Campaign, summaries.campaigns),
    },
    {
      name: "events",
      count: "events",
      load: () => homepageFacet(models.Event, summaries.events),
    },
    {
      name: "trainings",
      count: "trainings",
      load: () => homepageFacet(models.Training, summaries.trainings),
    },
    {
      name: "stories",
      load: () => homepageFacet(models.Publication, summaries.stories, false),
    },
    {
      name: "partners",
      load: () => homepageFacet(models.Partner, summaries.partners, false),
    },
    {
      name: "recommendations",
      count: "recommendations",
      load: () => homepageFacet(models.Recommendation, summaries.recommendations),
    },
    {
      name: "metrics",
      load: async () => {
        const items = await models.Metric.aggregate([
          { $match: PUBLICATION_FILTER },
          { $sort: { _id: -1 } },
          { $limit: 8 },
          { $project: { _id: 1, key: 1, label: 1, value: 1, iconName: 1 } },
        ])
          .option({ maxTimeMS: 2000 })
          .exec();
        return items.map(publicItem);
      },
    },
  ];

  try {
    const results = await Promise.all(
      sections.map(({ name, load }) => readHomepageSection(name, load))
    );
    const payload = {
      counts: {
        projects: null,
        campaigns: null,
        events: null,
        trainings: null,
        recommendations: null,
      },
      projects: null,
      campaigns: null,
      events: null,
      trainings: null,
      stories: null,
      partners: null,
      recommendations: null,
      metrics: null,
      failedSections: [],
    };

    for (const result of results) {
      if (result.error) {
        payload.failedSections.push(result.name);
        continue;
      }
      const section = sections.find(({ name }) => name === result.name);
      if (section.count) payload.counts[section.count] = result.value.total;
      payload[result.name] = section.count ? result.value.items : result.value.items || result.value;
    }

    return res.json(payload);
  } catch (error) {
    console.error(`GET /homepage error: ${error.message}`);
    return res.status(503).json({ error: "Homepage content is temporarily unavailable" });
  }
});

const PROJECT_STATUSES = new Set(["Ongoing", "Active", "Completed", "Planned"]);
const PROJECT_SUMMARY_FIELDS =
  "_id title category status shortDescription image location reportLink driveLink link";

router.get("/public/projects", async (req, res) => {
  setPublicCacheHeaders(res);
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 24))
    : 12;
  const status = req.query.status;
  if (status && status !== "All" && !PROJECT_STATUSES.has(status)) {
    return res.status(400).json({ error: "Unsupported project status filter" });
  }

  const filter = publicFilter(
    status && status !== "All" ? { status } : {}
  );
  const itemFilter = { ...filter };
  const countFilter = { ...filter };
  const idFilter = {};
  if (req.query.exclude) {
    if (!mongoose.isValidObjectId(req.query.exclude)) {
      return res.status(400).json({ error: "Invalid excluded project ID" });
    }
    idFilter.$ne = new mongoose.Types.ObjectId(req.query.exclude);
    countFilter._id = { $ne: idFilter.$ne };
  }
  if (req.query.cursor) {
    if (!mongoose.isValidObjectId(req.query.cursor)) {
      return res.status(400).json({ error: "Invalid project cursor" });
    }
    idFilter.$lt = new mongoose.Types.ObjectId(req.query.cursor);
  }
  if (Object.keys(idFilter).length) itemFilter._id = idFilter;

  try {
    const [documents, total] = await Promise.all([
      models.Project.find(itemFilter)
        .select(PROJECT_SUMMARY_FIELDS)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .maxTimeMS(2000)
        .lean()
        .exec(),
      models.Project.countDocuments(countFilter).maxTimeMS(2000).exec(),
    ]);
    const hasMore = documents.length > limit;
    const items = documents.slice(0, limit).map(publicItem);
    return res.json({
      items,
      pagination: {
        limit,
        total,
        hasMore,
        nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
      },
    });
  } catch (error) {
    console.error(`GET /public/projects error: ${error.message}`);
    return res.status(503).json({ error: "Projects are temporarily unavailable" });
  }
});

router.get("/public/projects/:id", async (req, res) => {
  setPublicCacheHeaders(res);
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Project not found" });
  }
  try {
    const project = await models.Project.findOne(
      publicFilter({ _id: new mongoose.Types.ObjectId(req.params.id) })
    )
      .select(
        "_id title category status shortDescription description overview image coverImage images gallery objectives location timeline reportLink driveLink link"
      )
      .maxTimeMS(2000)
      .lean()
      .exec();
    if (!project) return res.status(404).json({ error: "Project not found" });
    return res.json(publicItem(project));
  } catch (error) {
    console.error(`GET /public/projects/${req.params.id} error: ${error.message}`);
    return res.status(503).json({ error: "Project is temporarily unavailable" });
  }
});

// Helper to generate CRUD routes for a given model
function createCrudRoutes(
  path,
  Model,
  { isPublic = true, allowPublicCreate = false } = {}
) {
  const readMiddleware = isPublic ? [] : [requireAdmin];
  const createMiddleware = allowPublicCreate ? [] : [requireAdmin];

  // GET all (supports optional query filtering like ?group=advisors or ?type=stories)
  router.get(path, ...readMiddleware, async (req, res) => {
    try {
      res.setHeader(
        "Cache-Control",
        isPublic ? PUBLIC_CACHE_CONTROL : "private, no-store"
      );
      const query = Model.schema?.path("published")
        ? publicFilter(req.query)
        : req.query;
      const items = await Model.find(query).sort({ _id: -1 }).lean().exec();
      return res.json(items);
    } catch (err) {
      console.error(`GET ${path} error:`, err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET single item by ID
  router.get(`${path}/:id`, ...readMiddleware, async (req, res) => {
    try {
      res.setHeader(
        "Cache-Control",
        isPublic ? PUBLIC_CACHE_CONTROL : "private, no-store"
      );
      const query = Model.schema?.path("published")
        ? publicFilter({ _id: req.params.id })
        : { _id: req.params.id };
      const item = await Model.findOne(query).lean().exec();
      if (!item) return res.status(404).json({ error: "Item not found" });
      return res.json(item);
    } catch (err) {
      console.error(`GET ${path}/${req.params.id} error:`, err);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST create
  router.post(path, ...createMiddleware, async (req, res) => {
    try {
      const item = new Model(req.body);
      await item.save();
      await revalidateFrontend(path, res);
      return res.status(201).json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PUT update
  router.put(`${path}/:id`, requireAdmin, async (req, res) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!item) return res.status(404).json({ error: "Item not found" });
      await revalidateFrontend(path, res);
      return res.json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE
  router.delete(`${path}/:id`, requireAdmin, async (req, res) => {
    try {
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found" });
      await revalidateFrontend(path, res);
      return res.json({ message: "Deleted successfully", id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

createCrudRoutes("/team", models.TeamMember);
createCrudRoutes("/projects", models.Project);
createCrudRoutes("/campaigns", models.Campaign);
createCrudRoutes("/events", models.Event);
createCrudRoutes("/trainings", models.Training);
createCrudRoutes("/publications", models.Publication);
createCrudRoutes("/get-involved", models.GetInvolvedRoute);
createCrudRoutes("/partners", models.Partner);
createCrudRoutes("/submissions", models.Submission, {
  isPublic: false,
  allowPublicCreate: true,
});
createCrudRoutes("/metrics", models.Metric);
createCrudRoutes("/recommendations", models.Recommendation);
createCrudRoutes("/social-links", models.SocialLink);
createCrudRoutes("/subscribers", models.Subscriber, {
  isPublic: false,
  allowPublicCreate: true,
});
createCrudRoutes("/jobs", models.JobPost);
createCrudRoutes("/hero-slides", models.HeroSlide);

// Batch route to fetch all core website data in 1 database call
router.get("/batch", async (req, res) => {
  try {
    setPublicCacheHeaders(res);
    const [team, projects, campaigns, events, trainings, publications, partners, metrics, recommendations, socialLinks, heroSlides] =
      await Promise.all([
        models.TeamMember.find().sort({ order: 1, _id: -1 }).lean().exec(),
        models.Project.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Campaign.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Event.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Training.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Publication.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Partner.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Metric.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.Recommendation.find(publicFilter()).sort({ _id: -1 }).lean().exec(),
        models.SocialLink.find().sort({ _id: -1 }).lean().exec(),
        models.HeroSlide.find(publicFilter()).sort({ order: 1, _id: -1 }).lean().exec(),
      ]);

    res.json({
      team,
      projects,
      campaigns,
      events,
      trainings,
      publications,
      partners,
      metrics,
      recommendations,
      socialLinks,
      heroSlides,
    });
  } catch (err) {
    console.error("GET /batch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Legacy plaintext credentials are replaced by the configured initial password.
async function getOrCreateAdminConfig() {
  let config = await models.AdminConfig.findOne({ key: ADMIN_CONFIG_KEY })
    .select("+password +passwordHash +passwordSalt");
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;

  if (!config) {
    if (!isStrongPassword(initialPassword)) {
      throw new Error(
        "Set ADMIN_INITIAL_PASSWORD to a password that meets the security requirements"
      );
    }
    const { hash, salt } = await createPasswordHash(initialPassword);
    return models.AdminConfig.create({
      key: ADMIN_CONFIG_KEY,
      username: process.env.ADMIN_INITIAL_USERNAME || "admin",
      passwordHash: hash,
      passwordSalt: salt,
    });
  }

  if (!config.passwordHash || !config.passwordSalt) {
    if (!isStrongPassword(initialPassword)) {
      throw new Error(
        "Set ADMIN_INITIAL_PASSWORD to migrate the existing admin password"
      );
    }
    const { hash, salt } = await createPasswordHash(initialPassword);
    config.passwordHash = hash;
    config.passwordSalt = salt;
  }
  if (config.password !== undefined) config.password = undefined;
  await config.save();
  return config;
}

router.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const config = await getOrCreateAdminConfig();

    if (
      typeof username !== "string" ||
      username !== config.username ||
      !(await verifyPassword(password, config))
    ) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = randomBytes(32).toString("base64url");
    config.sessionTokenHash = hashToken(token);
    config.sessionExpiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
    await config.save();
    return res.json({
      success: true,
      token,
      expiresAt: config.sessionExpiresAt,
    });
  } catch (err) {
    console.error(`Admin login failed: ${err.message}`);
    return res.status(503).json({ error: "Admin authentication is temporarily unavailable" });
  }
});

router.post("/admin/logout", requireAdmin, async (req, res) => {
  try {
    await models.AdminConfig.updateOne(
      { _id: req.adminConfig._id },
      { $unset: { sessionTokenHash: 1, sessionExpiresAt: 1 } }
    );
    return res.json({ success: true });
  } catch (error) {
    console.error(`Admin logout failed: ${error.message}`);
    return res.status(500).json({ error: "Could not end the admin session" });
  }
});

router.put("/admin/change-password", requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const config = req.adminConfig;

    if (!(await verifyPassword(currentPassword, config))) {
      return res.status(400).json({ error: "Current password does not match" });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "New password must be at least 8 characters and meet 4 security requirements",
      });
    }

    const { hash, salt } = await createPasswordHash(newPassword);
    config.passwordHash = hash;
    config.passwordSalt = salt;
    config.password = undefined;
    config.sessionTokenHash = undefined;
    config.sessionExpiresAt = undefined;
    await config.save();

    return res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
