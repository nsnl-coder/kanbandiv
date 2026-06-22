import { LegalPage, Section } from "./legal-page";

const CONTACT_EMAIL = "nsnl.only@gmail.com";

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy" updated="June 22, 2026">
      <p>
        This Privacy Policy explains how Trello Clone (&quot;we&quot;,
        &quot;us&quot;, or &quot;the Service&quot;) collects, uses, and protects
        information when you use our project and board management application. By
        using the Service you agree to the practices described here.
      </p>

      <Section heading="Information we collect">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account information.</strong> Your name, email address, and a
            securely hashed password when you register.
          </li>
          <li>
            <strong>Content you create.</strong> Projects, boards, lists, cards,
            comments, and any files you upload.
          </li>
          <li>
            <strong>Usage and technical data.</strong> Log data such as IP
            address, browser type, and timestamps, used to operate and secure the
            Service.
          </li>
          <li>
            <strong>Google account data.</strong> If you connect Google Drive for
            backups, we access only the Drive permissions you explicitly grant
            during the OAuth consent flow.
          </li>
        </ul>
      </Section>

      <Section heading="How we use information">
        <ul className="list-disc space-y-2 pl-6">
          <li>To provide, maintain, and improve the Service.</li>
          <li>To authenticate you and keep your account secure.</li>
          <li>To send transactional email such as verification and password reset.</li>
          <li>To store backups in your connected Google Drive, when enabled.</li>
        </ul>
      </Section>

      <Section heading="Google API services and limited use">
        <p>
          Our use and transfer of information received from Google APIs adheres
          to the{" "}
          <a
            className="text-indigo-400 hover:underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We only access Google Drive to
          upload and manage backups you initiate, and we never sell this data or
          use it for advertising.
        </p>
      </Section>

      <Section heading="How we share information">
        <p>
          We do not sell your personal information. We share it only with service
          providers that help us operate the Service (such as hosting, email
          delivery, and error monitoring), and when required by law. Content you
          create is visible to other users you grant access to.
        </p>
      </Section>

      <Section heading="Data retention and security">
        <p>
          We retain your data for as long as your account is active. We use
          industry-standard measures including encryption in transit, hashed
          passwords, and access controls to protect your information. No method of
          transmission or storage is completely secure.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You may access, update, or delete your account data at any time from
          your settings, or by contacting us. You may also disconnect Google Drive
          at any time, which revokes our access to it.
        </p>
      </Section>

      <Section heading="Contact us">
        <p>
          For any questions about this Privacy Policy, contact us at{" "}
          <a className="text-indigo-400 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
