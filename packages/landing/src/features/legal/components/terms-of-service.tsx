import { LegalPage, Section } from "./legal-page";

const CONTACT_EMAIL = "nsnl.only@gmail.com";

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service" updated="June 22, 2026">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use
        of Trello Clone (&quot;the Service&quot;). By creating an account or using
        the Service, you agree to these Terms.
      </p>

      <Section heading="Eligibility and accounts">
        <p>
          You must provide accurate registration information and are responsible
          for keeping your password confidential and for all activity under your
          account. Notify us promptly of any unauthorized use.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <ul className="list-disc space-y-2 pl-6">
          <li>Do not use the Service for any unlawful or harmful purpose.</li>
          <li>Do not upload content that infringes the rights of others.</li>
          <li>
            Do not attempt to disrupt, reverse engineer, or gain unauthorized
            access to the Service.
          </li>
        </ul>
      </Section>

      <Section heading="Your content">
        <p>
          You retain ownership of the projects, boards, cards, and files you
          create. You grant us a limited license to store and process that content
          solely to operate the Service for you. You are responsible for the
          content you upload and share.
        </p>
      </Section>

      <Section heading="Third-party services">
        <p>
          The Service may integrate with third-party providers such as Google
          Drive. Your use of those integrations is also subject to the relevant
          third party&apos;s terms and privacy policies.
        </p>
      </Section>

      <Section heading="Availability and changes">
        <p>
          We provide the Service on an &quot;as is&quot; and &quot;as
          available&quot; basis and may modify, suspend, or discontinue features at
          any time. We may update these Terms; continued use after changes
          constitutes acceptance.
        </p>
      </Section>

      <Section heading="Limitation of liability">
        <p>
          To the maximum extent permitted by law, the Service is not liable for any
          indirect, incidental, or consequential damages arising from your use of
          the Service.
        </p>
      </Section>

      <Section heading="Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate
          your access if you violate these Terms.
        </p>
      </Section>

      <Section heading="Contact us">
        <p>
          For any questions about these Terms, contact us at{" "}
          <a className="text-indigo-400 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
