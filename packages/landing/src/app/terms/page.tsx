import type { Metadata } from "next";
import { TermsOfService } from "@/features/legal/components/terms-of-service";

export const metadata: Metadata = {
  title: "Terms of Service | Trello Clone",
  description: "The terms that govern your use of Trello Clone.",
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return <TermsOfService />;
}
