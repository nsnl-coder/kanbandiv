import type { Metadata } from "next";
import { PrivacyPolicy } from "@/features/legal/components/privacy-policy";

export const metadata: Metadata = {
  title: "Privacy Policy | Trello Clone",
  description: "How Trello Clone collects, uses, and protects your information.",
  alternates: { canonical: "/privacy" },
};

export default function Page() {
  return <PrivacyPolicy />;
}
