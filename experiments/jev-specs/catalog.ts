/**
 * Fields Jev may pick from: each a ready fieldspec declaration with a plain description of what
 * it asks for. Jev chooses; it never writes a declaration.
 */
import type { FieldDecl } from "../../src/index.ts";

export interface Entry {
  readonly key: string;
  /** What the field asks for, as Jev reads it. */
  readonly asks: string;
  readonly section: string;
  readonly decl: FieldDecl;
  /** Fields that ask for nearly the same thing share a slot; a form takes only the likeliest. */
  readonly slot?: string;
}

export const SECTIONS: Record<string, string> = {
  account: "Account",
  about: "About you",
  contact: "Contact",
  address: "Address",
  company: "Company",
  order: "Order",
  appointment: "Appointment",
  feedback: "Details",
  device: "Device",
  preferences: "Preferences",
  notifications: "Notifications",
  service: "Service",
};

const choices = (...values: string[]) => values.map((v) => ({ value: v.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: v }));

export const CATALOG: readonly Entry[] = [
  // account
  { key: "email", asks: "the person's email address", section: "account", slot: "email", decl: { use: "email", label: "Email" } },
  { key: "password", asks: "a password for a new account", section: "account", decl: { use: "password", label: "Password", hint: "At least 12 characters." } },
  { key: "username", asks: "a public username or handle", section: "account", decl: { type: "string", label: "Username", maxLength: 30 } },
  { key: "acceptTerms", asks: "agreement to the terms of service", section: "account", decl: { type: "boolean", label: "I accept the terms of service" } },
  // about
  { key: "fullName", asks: "the person's full name", section: "about", decl: { type: "string", label: "Full name" } },
  { key: "birthDate", asks: "the person's date of birth", section: "about", decl: { type: "date", label: "Date of birth" } },
  { key: "jobTitle", asks: "the person's job title", section: "about", decl: { type: "string", label: "Job title" } },
  { key: "avatar", asks: "a profile picture", section: "about", decl: { type: "bytes", label: "Profile picture", accept: ["image/*"] } },
  { key: "bio", asks: "a short biography", section: "about", decl: { use: "multiline", label: "Bio", maxLength: 280 } },
  // contact
  { key: "phone", asks: "a phone number", section: "contact", decl: { type: "string", label: "Phone", placeholder: "+31 6 1234 5678" } },
  { key: "contactMethod", asks: "how the person prefers to be contacted (email, phone or text)", section: "contact", decl: { type: "enum", label: "Contact me by", options: choices("Email", "Phone", "Text message"), render: "segmented" } },
  { key: "subject", asks: "the subject of a message", section: "contact", decl: { type: "string", label: "Subject" } },
  { key: "message", asks: "a free-form message", section: "contact", slot: "body", decl: { use: "multiline", label: "Message" } },
  // address
  {
    key: "address",
    asks: "a full postal or shipping address",
    section: "address",
    decl: {
      type: "object",
      label: "Address",
      fields: {
        street: { type: "string", label: "Street and number", required: true },
        postalCode: { type: "string", label: "Postal code", maxLength: 10, group: "place" },
        city: { type: "string", label: "City", required: true, group: "place" },
        country: { type: "enum", label: "Country", options: choices("Netherlands", "Germany", "France", "United Kingdom", "United States", "Other") },
      },
      groups: { place: { render: "row" } },
    },
  },
  { key: "street", asks: "a street address", section: "address", decl: { type: "string", label: "Street and number" } },
  { key: "city", asks: "a city", section: "address", decl: { type: "string", label: "City" } },
  { key: "postalCode", asks: "a postal or ZIP code", section: "address", decl: { type: "string", label: "Postal code", maxLength: 10 } },
  { key: "country", asks: "a country", section: "address", decl: { type: "enum", label: "Country", options: choices("Netherlands", "Germany", "France", "United Kingdom", "United States", "Other") } },
  // company
  { key: "companyName", asks: "the name of a company or organisation", section: "company", decl: { type: "string", label: "Company" } },
  { key: "teamSize", asks: "how many people are on a team or in a company", section: "company", decl: { type: "enum", label: "Team size", options: choices("1–10", "11–50", "51–200", "201+") } },
  { key: "industry", asks: "the company's industry", section: "company", decl: { type: "enum", label: "Industry", options: choices("Software", "Finance", "Healthcare", "Retail", "Education", "Other") } },
  { key: "website", asks: "a website address", section: "company", decl: { type: "url", label: "Website", protocols: ["https:", "http:"] } },
  // order
  { key: "deliveryMethod", asks: "whether an order is shipped or picked up", section: "order", decl: { type: "enum", label: "Delivery", options: choices("Ship", "Pick up"), render: "segmented" } },
  { key: "deliveryDate", asks: "a preferred delivery date", section: "order", decl: { type: "date", label: "Delivery date" } },
  { key: "giftWrap", asks: "whether to gift-wrap an order", section: "order", decl: { type: "boolean", label: "Gift wrap", render: "switch" } },
  { key: "couponCode", asks: "a discount or coupon code", section: "order", decl: { type: "string", label: "Coupon code" } },
  { key: "quantity", asks: "how many items to order", section: "order", decl: { type: "int", label: "Quantity", min: 1, max: 99, default: 1 } },
  // appointment
  { key: "appointmentDate", asks: "a date and time for an appointment or booking", section: "appointment", decl: { type: "date", label: "Date and time", time: true } },
  { key: "reason", asks: "the reason for a visit or appointment", section: "appointment", decl: { type: "enum", label: "Reason", options: choices("Check-up", "Cleaning", "Pain or emergency", "Other") } },
  { key: "newPatient", asks: "whether the person is a new patient or customer", section: "appointment", decl: { type: "boolean", label: "I'm a new patient", render: "switch" } },
  { key: "guests", asks: "how many guests or people are coming", section: "appointment", decl: { type: "int", label: "Guests", min: 1, max: 20, default: 1 } },
  // feedback
  { key: "title", asks: "a short title or summary", section: "feedback", decl: { type: "string", label: "Title", maxLength: 120 } },
  { key: "description", asks: "a detailed description", section: "feedback", slot: "body", decl: { use: "multiline", label: "Description" } },
  { key: "stepsToReproduce", asks: "the steps to reproduce a problem", section: "feedback", decl: { use: "multiline", label: "Steps to reproduce", placeholder: "1. Open…\n2. Tap…" } },
  { key: "expected", asks: "what the person expected to happen", section: "feedback", decl: { use: "multiline", label: "What did you expect?" } },
  { key: "severity", asks: "how severe a problem is", section: "feedback", decl: { type: "enum", label: "Severity", options: choices("Cosmetic", "Annoying", "Blocks me", "Crash or data loss"), render: "radio" } },
  { key: "screenshot", asks: "a screenshot or attachment", section: "feedback", decl: { type: "bytes", label: "Screenshot", accept: ["image/*"] } },
  { key: "rating", asks: "a rating from 1 to 5", section: "feedback", decl: { type: "int", label: "Rating", min: 1, max: 5, render: "slider" } },
  // device
  { key: "platform", asks: "the device's operating system (iOS or Android)", section: "device", decl: { type: "enum", label: "Platform", options: choices("iOS", "Android"), render: "segmented" } },
  { key: "osVersion", asks: "the operating system version", section: "device", decl: { type: "string", label: "OS version", placeholder: "17.4" } },
  { key: "appVersion", asks: "the app version", section: "device", decl: { type: "string", label: "App version", placeholder: "3.2.1" } },
  { key: "deviceModel", asks: "the device model", section: "device", decl: { type: "string", label: "Device", placeholder: "Pixel 8" } },
  // preferences
  { key: "language", asks: "a preferred language", section: "preferences", decl: { type: "enum", label: "Language", options: choices("English", "Nederlands", "Deutsch", "Français") } },
  { key: "timezone", asks: "a time zone", section: "preferences", decl: { type: "enum", label: "Time zone", options: choices("UTC", "Europe/Amsterdam", "America/New_York", "Asia/Tokyo") } },
  { key: "theme", asks: "a light or dark appearance", section: "preferences", decl: { type: "enum", label: "Theme", options: choices("Light", "Dark", "System"), render: "segmented" } },
  { key: "topics", asks: "which topics the person is interested in", section: "preferences", decl: { type: "set", label: "Topics", items: { type: "enum", options: choices("Product news", "Tips and tutorials", "Events", "Offers") }, render: "checks" } },
  // notifications
  { key: "newsletter", asks: "whether to receive a newsletter or marketing email", section: "notifications", slot: "onOff", decl: { type: "boolean", label: "Send me the newsletter", render: "switch" } },
  { key: "frequency", asks: "how often to receive emails (daily, weekly or monthly)", section: "notifications", decl: { type: "enum", label: "How often", options: choices("Daily", "Weekly", "Monthly"), render: "segmented" } },
  { key: "notifyEmail", asks: "an email address to send alerts or notifications to", section: "notifications", slot: "email", decl: { use: "email", label: "Alert email" } },
  { key: "unsubscribeAll", asks: "whether to unsubscribe from all email", section: "notifications", decl: { type: "boolean", label: "Unsubscribe from everything" } },
  // service
  { key: "schedule", asks: "how often a job or task runs (hourly, daily or weekly)", section: "service", decl: { type: "enum", label: "Runs", options: choices("Hourly", "Daily", "Weekly"), render: "segmented" } },
  { key: "retries", asks: "how many times to retry after a failure", section: "service", decl: { type: "int", label: "Retries", min: 0, max: 10, default: 3 } },
  { key: "timeoutSeconds", asks: "a timeout in seconds", section: "service", decl: { type: "int", label: "Timeout", min: 1, max: 3600, unit: "s", default: 60 } },
  { key: "retentionDays", asks: "how many days to keep data or backups", section: "service", decl: { type: "int", label: "Keep for", min: 1, max: 365, unit: "days", default: 30 } },
  { key: "enabled", asks: "whether a service or feature is turned on", section: "service", slot: "onOff", decl: { type: "boolean", label: "Enabled", render: "switch", default: true } },
  { key: "webhookUrl", asks: "a webhook URL to call", section: "service", decl: { type: "url", label: "Webhook URL", protocols: ["https:"] } },
  { key: "logLevel", asks: "how much to log (debug, info or warnings only)", section: "service", decl: { type: "enum", label: "Log level", options: choices("Debug", "Info", "Warn"), render: "radio" } },
];
