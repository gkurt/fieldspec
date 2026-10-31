/**
 * Form-filling cases: a message someone sent, the form it should fill, and the right answers.
 * Each field is tagged with what filling it takes:
 * - copy: the value is written in the message.
 * - choose: one of the field's options, or yes/no, follows from the message.
 * - compute: worked out from the message ("2 minutes" → 120 seconds, "next Thursday" → a date).
 * - write: has to be composed (a title, a short bio); the message does not contain it.
 * - absent: the message does not say; the field must stay empty.
 */
import { define, type Spec } from '#src/index.ts';

export type Need = 'copy' | 'choose' | 'compute' | 'write' | 'absent';

export interface Gold {
  /** The right value; null when the message does not say. */
  readonly value: unknown;
  readonly need: Need;
  /** Other acceptable values (text fields). */
  readonly also?: readonly string[];
}

export interface Case {
  readonly id: string;
  readonly title: string;
  /** The day the message was written, for relative dates. */
  readonly today: string;
  readonly source: string;
  readonly spec: Spec;
  readonly gold: Record<string, Gold>;
}

const opts = (...labels: string[]) =>
  labels.map((label) => ({
    value: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
    label,
  }));

export const CASES: readonly Case[] = [
  {
    id: 'rsvp',
    title: 'Wedding RSVP from a reply',
    today: '2026-10-30',
    source:
      "Hi both! So happy for you. Count us in: it'll be me, Tom Becker, plus my partner Ana, so two of us. I'll have the fish, and Ana's vegetarian. No allergies on our side. Could the band play 'September' by Earth, Wind & Fire?",
    spec: define({
      fields: {
        guestName: { type: 'string', label: 'Guest name' },
        attending: { type: 'boolean', label: 'Attending' },
        guests: { type: 'int', label: 'Number of guests', min: 1, max: 20 },
        meal: { type: 'enum', label: 'Meal choice', options: opts('Beef', 'Fish', 'Vegetarian') },
        dietary: { type: 'string', label: 'Dietary restrictions' },
        song: { type: 'string', label: 'Song request' },
      },
    }),
    gold: {
      guestName: { value: 'Tom Becker', need: 'copy' },
      attending: { value: true, need: 'choose' },
      guests: { value: 2, need: 'copy' },
      meal: { value: 'fish', need: 'choose' },
      dietary: {
        value: "Ana's vegetarian",
        need: 'copy',
        also: ['Ana is vegetarian', 'vegetarian', 'Ana: vegetarian', 'No allergies; Ana is vegetarian'],
      },
      song: { value: "'September' by Earth, Wind & Fire", need: 'copy', also: ['September by Earth, Wind & Fire', 'September'] },
    },
  },
  {
    id: 'bug',
    title: 'Bug report from a support message',
    today: '2026-10-30',
    source:
      "The app keeps crashing when I try to upload a photo to my profile. I open Settings, tap Profile picture, choose a photo from the gallery and it closes immediately. It happens every time since yesterday's update. I'm on a Pixel 8 running Android 15, app version 4.2.1. I'd expect it to just upload the photo like before.",
    spec: define({
      fields: {
        title: { type: 'string', label: 'Title', maxLength: 80, description: 'A short summary of the problem' },
        steps: { type: 'string', label: 'Steps to reproduce', render: 'textarea' },
        expected: { type: 'string', label: 'What did you expect?' },
        severity: { type: 'enum', label: 'Severity', options: opts('Cosmetic', 'Annoying', 'Blocks me', 'Crash or data loss') },
        platform: { type: 'enum', label: 'Platform', options: opts('iOS', 'Android') },
        osVersion: { type: 'string', label: 'OS version' },
        appVersion: { type: 'string', label: 'App version' },
        device: { type: 'string', label: 'Device' },
      },
    }),
    gold: {
      title: { value: 'App crashes when uploading a profile photo', need: 'write' },
      steps: {
        value: 'I open Settings, tap Profile picture, choose a photo from the gallery and it closes immediately',
        need: 'copy',
        also: [
          'Open Settings, tap Profile picture, choose a photo from the gallery',
          '1. Open Settings 2. Tap Profile picture 3. Choose a photo from the gallery',
        ],
      },
      expected: {
        value: 'it to just upload the photo like before',
        need: 'copy',
        also: ['Upload the photo like before', 'The photo uploads like before'],
      },
      severity: { value: 'crash-or-data-loss', need: 'choose' },
      platform: { value: 'android', need: 'choose' },
      osVersion: { value: '15', need: 'copy', also: ['Android 15'] },
      appVersion: { value: '4.2.1', need: 'copy' },
      device: { value: 'Pixel 8', need: 'copy' },
    },
  },
  {
    id: 'booking',
    title: 'Meeting room booking from a chat message',
    today: '2026-11-02',
    source:
      "Hi! Could I book a room for next Thursday at 2pm? We'll be 6 people and need about 90 minutes. Coffee would be great, thanks! Marta",
    spec: define({
      fields: {
        bookedBy: { type: 'string', label: 'Booked by' },
        people: { type: 'int', label: 'Number of people', min: 1, max: 12 },
        start: { type: 'date', time: true, label: 'Start' },
        hours: { type: 'number', label: 'Duration', unit: 'hours', min: 0.5, max: 4 },
        catering: { type: 'enum', label: 'Catering', options: opts('None', 'Coffee', 'Lunch') },
        purpose: { type: 'string', label: 'Purpose of the meeting' },
      },
    }),
    gold: {
      bookedBy: { value: 'Marta', need: 'copy' },
      people: { value: 6, need: 'copy' },
      start: { value: '2026-11-05T14:00', need: 'compute' },
      hours: { value: 1.5, need: 'compute' },
      catering: { value: 'coffee', need: 'choose' },
      purpose: { value: null, need: 'absent' },
    },
  },
  {
    id: 'worker',
    title: 'Worker settings from an ops ticket',
    today: '2026-10-30',
    source:
      "Prod workers are timing out under load. Please raise the request timeout to 2 minutes, allow 5 retries, run 16 workers, and give it a 4 GB cache. Keep logs for 30 days and switch logging to debug until we've found the cause.",
    spec: define({
      fields: {
        timeout: { type: 'int', label: 'Request timeout', unit: 'seconds', min: 5, max: 300 },
        retries: { type: 'int', label: 'Retries', min: 0, max: 10 },
        workers: { type: 'int', label: 'Workers', min: 1, max: 64 },
        cache: { type: 'number', label: 'Cache size', unit: 'GB', max: 8 },
        retention: { type: 'int', label: 'Keep logs for', unit: 'days' },
        logLevel: { type: 'enum', label: 'Log level', options: opts('Debug', 'Info', 'Warn') },
        change: { type: 'string', label: 'Change summary', maxLength: 100, description: 'One line for the audit log' },
      },
    }),
    gold: {
      timeout: { value: 120, need: 'compute' },
      retries: { value: 5, need: 'copy' },
      workers: { value: 16, need: 'copy' },
      cache: { value: 4, need: 'copy' },
      retention: { value: 30, need: 'copy' },
      logLevel: { value: 'debug', need: 'choose' },
      change: { value: 'Raise timeout to 120 s, 5 retries, 16 workers, 4 GB cache, debug logging', need: 'write' },
    },
  },
  {
    id: 'signup',
    title: 'Sign-up from an introduction email',
    today: '2026-10-30',
    source:
      "Hi, I'm Priya Shah, CTO at Lumen Labs (lumenlabs.io). We're a team of about 40. You can reach me at priya@lumenlabs.io. Please don't sign me up for any newsletters.",
    spec: define({
      fields: {
        fullName: { type: 'string', label: 'Full name' },
        email: { type: 'string', label: 'Email', format: 'email' },
        jobTitle: { type: 'string', label: 'Job title' },
        company: { type: 'string', label: 'Company' },
        website: { type: 'url', label: 'Website' },
        teamSize: { type: 'enum', label: 'Team size', options: opts('1–10', '11–50', '51–200', '201+') },
        newsletter: { type: 'boolean', label: 'Send me the newsletter' },
        password: { type: 'string', label: 'Password' },
      },
    }),
    gold: {
      fullName: { value: 'Priya Shah', need: 'copy' },
      email: { value: 'priya@lumenlabs.io', need: 'copy' },
      jobTitle: { value: 'CTO', need: 'copy' },
      company: { value: 'Lumen Labs', need: 'copy' },
      website: { value: 'https://lumenlabs.io', need: 'compute', also: ['lumenlabs.io', 'http://lumenlabs.io'] },
      teamSize: { value: '11-50', need: 'choose' },
      newsletter: { value: false, need: 'choose' },
      password: { value: null, need: 'absent' },
    },
  },
  {
    id: 'profile',
    title: 'Profile page from a self-introduction',
    today: '2026-10-30',
    source:
      "I'm Sam Ortiz, a landscape photographer based in Lisbon. For the last ten years I've photographed coastlines across Portugal and Spain, mostly at dawn, and my work has appeared in National Geographic Traveller and Monocle. Besides shooting, I run weekend workshops for beginners and the occasional week-long trip along the Alentejo coast. I've also published two photo books with a small press in Porto. I prefer the dark theme.",
    spec: define({
      fields: {
        displayName: { type: 'string', label: 'Display name', maxLength: 40 },
        location: { type: 'string', label: 'Location' },
        headline: { type: 'string', label: 'Headline', maxLength: 60, description: 'A few words on what you do' },
        bio: {
          type: 'string',
          label: 'Bio',
          maxLength: 200,
          render: 'textarea',
          description: 'Two sentences about you, in the third person',
        },
        website: { type: 'url', label: 'Website' },
        theme: { type: 'enum', label: 'Theme', options: opts('Light', 'Dark') },
      },
    }),
    gold: {
      displayName: { value: 'Sam Ortiz', need: 'copy' },
      location: { value: 'Lisbon', need: 'copy' },
      headline: {
        value: 'Landscape photographer based in Lisbon',
        need: 'copy',
        also: ['landscape photographer', 'a landscape photographer based in Lisbon'],
      },
      bio: {
        value:
          'Sam Ortiz is a Lisbon-based landscape photographer who has spent ten years shooting the coasts of Portugal and Spain. Sam runs beginner workshops and has published two photo books.',
        need: 'write',
      },
      website: { value: null, need: 'absent' },
      theme: { value: 'dark', need: 'choose' },
    },
  },
  {
    id: 'checkout',
    title: 'Delivery details from an order note',
    today: '2026-10-30',
    source:
      "Please ship it to 221B Baker Street, London NW1 6XE, United Kingdom. It's a birthday present, so gift wrap would be lovely. If nobody's home, leave it with the neighbour at 223. Any day next week is fine.",
    spec: define({
      fields: {
        method: { type: 'enum', label: 'Delivery', options: opts('Ship', 'Pick up') },
        street: { type: 'string', label: 'Street and number' },
        postalCode: { type: 'string', label: 'Postal code' },
        city: { type: 'string', label: 'City' },
        country: {
          type: 'enum',
          label: 'Country',
          options: opts('Netherlands', 'Germany', 'France', 'United Kingdom', 'United States', 'Other'),
        },
        giftWrap: { type: 'boolean', label: 'Gift wrap' },
        courierNote: { type: 'string', label: 'Note for the courier' },
        giftMessage: { type: 'string', label: 'Gift message', description: 'Printed on a card inside the package' },
      },
    }),
    gold: {
      method: { value: 'ship', need: 'choose' },
      street: { value: '221B Baker Street', need: 'copy' },
      postalCode: { value: 'NW1 6XE', need: 'copy' },
      city: { value: 'London', need: 'copy' },
      country: { value: 'united-kingdom', need: 'choose' },
      giftWrap: { value: true, need: 'choose' },
      courierNote: {
        value: "If nobody's home, leave it with the neighbour at 223",
        need: 'copy',
        also: ["Leave it with the neighbour at 223 if nobody's home", 'leave it with the neighbour at 223'],
      },
      giftMessage: { value: null, need: 'absent' },
    },
  },
];
