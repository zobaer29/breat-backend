const mongoose = require("mongoose");

// Team Member Schema
const TeamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  position: { type: String, required: true },
  image: { type: String },
  facebook: { type: String },
  linkedin: { type: String },
  instagram: { type: String },
  twitter: { type: String },
  email: { type: String },
  socials: [
    {
      platform: { type: String },
      url: { type: String },
    },
  ],
  group: {
    type: String,
    enum: ["advisors", "board", "coordinators", "executives"],
    required: true,
  },
  order: { type: Number, default: 0 },
}, { strict: false });

// Project Schema
const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    category: { type: String },
    status: { type: String, default: "Active" },
    shortDescription: { type: String },
    description: { type: String },
    image: { type: String },
    images: [{ type: String }],
    duration: { type: String },
    location: { type: String },
    timeline: { type: String },
    link: { type: String },
    driveLink: { type: String },
    reportLink: { type: String },
  },
  { strict: false }
);

// Campaign Schema
const CampaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    status: { type: String, default: "Active" },
    description: { type: String },
    image: { type: String },
    images: [{ type: String }],
    category: { type: String },
    link: { type: String },
    driveLink: { type: String },
    reportLink: { type: String },
  },
  { strict: false }
);

// Event Schema
const EventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    type: { type: String, default: "Upcoming" },
    date: { type: String },
    time: { type: String },
    location: { type: String },
    description: { type: String },
    image: { type: String },
    images: [{ type: String }],
    link: { type: String },
    driveLink: { type: String },
    reportLink: { type: String },
  },
  { strict: false }
);

// Training Schema
const TrainingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    duration: { type: String },
    participants: { type: String },
    description: { type: String },
    image: { type: String },
    images: [{ type: String }],
    category: { type: String },
    location: { type: String },
    link: { type: String },
    driveLink: { type: String },
    reportLink: { type: String },
  },
  { strict: false }
);

// Publication Schema
const PublicationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    date: { type: String },
    excerpt: { type: String },
    content: { type: String },
    author: { type: String },
    location: { type: String },
    readTime: { type: String },
    image: { type: String },
    images: [{ type: String }],
    summary: { type: String },
    category: { type: String },
    fileType: { type: String },
    fileSize: { type: String },
    link: { type: String },
    driveLink: { type: String },
    reportLink: { type: String },
    year: { type: String },
    type: {
      type: String,
      enum: [
        "stories",
        "blogs",
        "pressReleases",
        "notices",
        "documents",
        "annualReports",
      ],
      required: true,
    },
  },
  { strict: false }
);

// Get Involved Route Schema
const GetInvolvedRouteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
});

// Partner Schema
const PartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String },
    description: { type: String },
    logoText: { type: String },
    image: { type: String },
    logoUrl: { type: String },
    logo: { type: String },
    link: { type: String },
    driveLink: { type: String },
  },
  { strict: false }
);

// Submission Schema for Form Applications & Inquiries
const SubmissionSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
  },
  name: { type: String },
  orgName: { type: String },
  contactPerson: { type: String },
  position: { type: String },
  institution: { type: String },
  email: { type: String },
  phone: { type: String },
  track: { type: String },
  trackType: { type: String },
  cvUrl: { type: String },
  cvName: { type: String },
  photoUrl: { type: String },
  message: { type: String },
  reason: { type: String },
  amount: { type: String },
  paymentMethod: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// Metric Schema for Homepage Impact Stats
const MetricSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  value: { type: String, required: true },
  iconName: { type: String, default: "Award" },
});

// Recommendation Schema for Institutional Endorsements
const RecommendationSchema = new mongoose.Schema({
  author: { type: String, required: true },
  position: { type: String },
  organization: { type: String },
  quote: { type: String },
  category: { type: String },
  image: { type: String },
  featured: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Social Link Schema for Organization Handles
const SocialLinkSchema = new mongoose.Schema({
  platform: { type: String, required: true },
  url: { type: String, required: true },
  label: { type: String },
});

// Subscriber Schema for Newsletter & Updates
const SubscriberSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, required: true },
  phone: { type: String },
  source: { type: String, default: "Website Subscribe Form" },
  createdAt: { type: Date, default: Date.now },
});

// Job Post / Career Track Schema
const JobPostSchema = new mongoose.Schema({
  title: { type: String, required: true },
  trackType: { type: String, default: "Full time" },
  department: { type: String },
  location: { type: String, default: "On-site / Hybrid" },
  description: { type: String },
  requirements: { type: String },
  status: { type: String, enum: ["Active", "Closed"], default: "Active" },
  createdAt: { type: Date, default: Date.now },
});

const TeamMember = mongoose.model("TeamMember", TeamMemberSchema);
const Project = mongoose.model("Project", ProjectSchema);
const Campaign = mongoose.model("Campaign", CampaignSchema);
const Event = mongoose.model("Event", EventSchema);
const Training = mongoose.model("Training", TrainingSchema);
const Publication = mongoose.model("Publication", PublicationSchema);
const GetInvolvedRoute = mongoose.model(
  "GetInvolvedRoute",
  GetInvolvedRouteSchema,
);
const Partner = mongoose.model("Partner", PartnerSchema);
const Submission = mongoose.model("Submission", SubmissionSchema);
const Metric = mongoose.model("Metric", MetricSchema);
const Recommendation = mongoose.model("Recommendation", RecommendationSchema);
const SocialLink = mongoose.model("SocialLink", SocialLinkSchema);
const Subscriber = mongoose.model("Subscriber", SubscriberSchema);
const JobPost = mongoose.model("JobPost", JobPostSchema);

// Admin Config Schema (stores persistent admin password in MongoDB)
const AdminConfigSchema = new mongoose.Schema({
  key: { type: String, default: "admin_credentials", unique: true },
  username: { type: String, default: "admin" },
  password: { type: String, default: "BreatAdmin#2026!" },
});

const AdminConfig = mongoose.models.AdminConfig || mongoose.model("AdminConfig", AdminConfigSchema);

// Hero Slide / Banner Schema
const HeroSlideSchema = new mongoose.Schema(
  {
    title: { type: String },
    subtitle: { type: String },
    image: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { strict: false }
);

const HeroSlide = mongoose.models.HeroSlide || mongoose.model("HeroSlide", HeroSlideSchema);

module.exports = {
  mongoose,
  TeamMember,
  Project,
  Campaign,
  Event,
  Training,
  Publication,
  GetInvolvedRoute,
  Partner,
  Submission,
  Metric,
  Recommendation,
  SocialLink,
  Subscriber,
  JobPost,
  AdminConfig,
  HeroSlide,
};

