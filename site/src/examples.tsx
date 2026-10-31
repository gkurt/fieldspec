/**
 * The example renderer sets, each drawing a live form: plain HTML, DialKit and React Aria. The
 * sets live in examples/renderers, to copy; fieldspec itself ships no look.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { htmlRenderers, htmlStyles } from '#examples/renderers/html.tsx';
import { define } from '#src/index.ts';
import { FormView, useForm, useFormState } from '#src/react/index.tsx';
import { Footer, Heading, Nav, REPO } from './chrome.tsx';
import { Code, Json } from './Code.tsx';
import { cardSource, DialKitDemo } from './DialKit.tsx';
import { meetupSource, ReactAriaDemo } from './ReactAria.tsx';
import './styles.css';

const teamSpec = define({
  fields: {
    team: { type: 'string', default: 'Forms', required: true },
    members: {
      type: 'array',
      namedBy: 'name',
      render: { type: 'accordion', props: { open: 'first', addLabel: 'Add a member' } },
      items: {
        type: 'object',
        fields: {
          name: { type: 'string', placeholder: 'Who' },
          role: { type: 'string', suggestions: { $state: '/roles' }, placeholder: 'Pick or type one' },
          focus: { type: 'enum', options: ['build', 'design', 'write'], default: 'build', render: 'segmented' },
        },
      },
      default: [
        { name: 'Ada', role: 'Engineer', focus: 'build' },
        { name: 'Lin', role: 'Designer', focus: 'design' },
        { name: 'Sam', role: 'Writer', focus: 'write' },
      ],
    },
    roles: { type: 'array', items: { type: 'string' }, default: ['Engineer', 'Designer', 'Writer'], label: 'Roles to suggest' },
    links: { type: 'record', values: { type: 'url' }, default: { docs: 'https://gkurt.com/fieldspec/' } },
  },
});

const teamSource = `import { FormView, useForm } from "fieldspec/react";
import { htmlRenderers, htmlStyles } from "./renderers/html"; // copied from fieldspec's examples/renderers

const team = define({
  fields: {
    members: {
      type: "array",
      namedBy: "name", // each section is headed by its member's name
      render: { type: "accordion", props: { open: "first" } },
      items: { type: "object", fields: {
        name: { type: "string" },
        role: { type: "string", suggestions: { $state: "/roles" } }, // offers what /roles holds
        …
      } },
    },
    roles: { type: "array", items: { type: "string" } },
    links: { type: "record", values: { type: "url" } },
  },
});

<style>{htmlStyles}</style>
<FormView form={useForm(team)} renderers={htmlRenderers} />`;

function HtmlDemo() {
  const form = useForm(teamSpec);
  const { json } = useFormState(form);
  return (
    <div className="aria-demo">
      <figure>
        <figcaption>examples/renderers/html</figcaption>
        <div className="card form-card">
          <FormView form={form} renderers={htmlRenderers} />
        </div>
      </figure>
      <figure>
        <figcaption>form.json()</figcaption>
        <Json value={json} className="aria-json" />
      </figure>
    </div>
  );
}

const LINKS = [
  ['#html', 'Plain HTML'],
  ['#dialkit', 'DialKit'],
  ['#react-aria', 'React Aria'],
  ['tutorial.html', 'Tutorial'],
  ['./', 'fieldspec', true],
] as const;

function App() {
  return (
    <>
      <style>{htmlStyles}</style>
      <Nav links={LINKS} home="./" />
      <main>
        <header className="hero models-hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">Examples · renderers</p>
            <h1>
              One spec,
              <br />
              <span className="accent-text">drawn however you like.</span>
            </h1>
            <p className="lede">
              fieldspec decides what a form holds and does; how it looks is yours. <code>FormView</code> asks a renderer set to draw each
              element, and these three sets, in <a href={`${REPO}/tree/main/examples/renderers`}>examples/renderers</a>, are there to copy
              into your app and make your own.
            </p>
          </div>
        </header>
        <section className="section" id="html">
          <Heading kicker="Plain HTML" title="Inputs, fieldsets and a little CSS">
            The HTML set draws with the browser's own elements, styled by <code>htmlStyles</code>. The members are an accordion: each
            section is headed by its member's name (<code>namedBy</code>) and moves by dragging its handle, or with the arrow keys. A
            member's role offers the roles listed below it as you type (<code>suggestions</code>), and a link's key is renamed in place.
          </Heading>
          <HtmlDemo />
          <Code code={teamSource} label="team.tsx" className="dial-code" />
        </section>
        <section className="section" id="dialkit">
          <Heading kicker="With DialKit" title="The same form, in DialKit's controls">
            The DialKit set draws a form with <a href="https://github.com/joshpuckett/dialkit">DialKit</a>'s sliders, toggles, selects,
            colour pickers and folders, while fieldspec keeps the values, conditions and checks. Lists and other shapes DialKit has no
            control for keep the HTML set's, inside a folder. Both views below are one form; edit either.
          </Heading>
          <DialKitDemo />
          <Code code={cardSource} label="card.tsx" className="dial-code" />
        </section>
        <section className="section" id="react-aria">
          <Heading kicker="With React Aria" title="Accessible controls, from the same spec">
            The React Aria set draws a form with <a href="https://react-spectrum.adobe.com/react-aria/">React Aria Components</a>: number
            fields with steppers, a date picker with a calendar, radio and toggle-button groups, checkbox groups, colour fields with
            swatches, and a combobox for the city's suggestions. Each control carries its own label, help and errors, wired the way React
            Aria wires them; what it has no control for, like the speakers' accordion, comes from the HTML set. Pick "Online" to see the
            city give way to a stream link.
          </Heading>
          <ReactAriaDemo />
          <Code code={meetupSource} label="meetup.tsx" className="dial-code" />
        </section>
      </main>
      <Footer>Every form on this page is drawn by FormView with the example renderers.</Footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
