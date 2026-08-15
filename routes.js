const express = require("express");
const router = express.Router();
const models = require("./models");

// Helper to generate CRUD routes for a given model
function createCrudRoutes(path, Model) {
  // GET all (supports optional query filtering like ?group=advisors or ?type=stories)
  router.get(path, async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=60");
      const items = await Model.find(req.query).sort({ _id: -1 }).lean().exec();
      return res.json(items);
    } catch (err) {
      console.error(`GET ${path} error:`, err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET single item by ID
  router.get(`${path}/:id`, async (req, res) => {
    try {
      const item = await Model.findById(req.params.id).lean().exec();
      if (!item) return res.status(404).json({ error: "Item not found" });
      return res.json(item);
    } catch (err) {
      console.error(`GET ${path}/${req.params.id} error:`, err);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST create
  router.post(path, async (req, res) => {
    try {
      const item = new Model(req.body);
      await item.save();
      return res.status(201).json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PUT update
  router.put(`${path}/:id`, async (req, res) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!item) return res.status(404).json({ error: "Item not found" });
      return res.json(item);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE
  router.delete(`${path}/:id`, async (req, res) => {
    try {
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found" });
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
createCrudRoutes("/submissions", models.Submission);
createCrudRoutes("/metrics", models.Metric);
createCrudRoutes("/recommendations", models.Recommendation);
createCrudRoutes("/social-links", models.SocialLink);
createCrudRoutes("/subscribers", models.Subscriber);
createCrudRoutes("/jobs", models.JobPost);
createCrudRoutes("/hero-slides", models.HeroSlide);

// Batch route to fetch all core website data in 1 database call
router.get("/batch", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=60");
    const [team, projects, campaigns, events, trainings, publications, partners, metrics, recommendations, socialLinks, heroSlides] =
      await Promise.all([
        models.TeamMember.find().sort({ order: 1, _id: -1 }).lean().exec(),
        models.Project.find().sort({ _id: -1 }).lean().exec(),
        models.Campaign.find().sort({ _id: -1 }).lean().exec(),
        models.Event.find().sort({ _id: -1 }).lean().exec(),
        models.Training.find().sort({ _id: -1 }).lean().exec(),
        models.Publication.find().sort({ _id: -1 }).lean().exec(),
        models.Partner.find().sort({ _id: -1 }).lean().exec(),
        models.Metric.find().sort({ _id: -1 }).lean().exec(),
        models.Recommendation.find().sort({ _id: -1 }).lean().exec(),
        models.SocialLink.find().sort({ _id: -1 }).lean().exec(),
        models.HeroSlide.find().sort({ order: 1, _id: -1 }).lean().exec(),
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

// Helper to retrieve or create default admin credentials in MongoDB
async function getOrCreateAdminConfig() {
  let config = await models.AdminConfig.findOne({ key: "admin_credentials" });
  if (!config) {
    config = await models.AdminConfig.create({
      key: "admin_credentials",
      username: "admin",
      password: "BreatAdmin#2026!",
    });
  }
  return config;
}

// GET admin credentials
router.get("/admin/credentials", async (req, res) => {
  try {
    const config = await getOrCreateAdminConfig();
    return res.json({ username: config.username, password: config.password });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST admin login (verifies directly against MongoDB)
router.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const config = await getOrCreateAdminConfig();

    if (username === config.username && password === config.password) {
      return res.json({ success: true, message: "Authentication successful" });
    }
    return res.status(401).json({ error: "Invalid username or password" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT admin change password (persists directly to MongoDB)
router.put("/admin/change-password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const config = await getOrCreateAdminConfig();

    if (currentPassword !== config.password) {
      return res.status(400).json({ error: "Current password does not match" });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long" });
    }

    config.password = newPassword;
    await config.save();

    return res.json({ success: true, message: "Password updated successfully in MongoDB" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
