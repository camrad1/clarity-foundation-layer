import { createFileRoute } from "@tanstack/react-router";

import { SetPasswordScreen } from "./accept-invite";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — ONELIFE Marketing Performance Hub" },
      { name: "description", content: "Choose a new password for your ClarityIQ account." },
      { property: "og:title", content: "Reset your password" },
      { property: "og:description", content: "Choose a new password for your ClarityIQ account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  return (
    <SetPasswordScreen
      heading="Reset your password"
      intro="Enter a new password for your ClarityIQ account."
      submitLabel="Update Password"
      invalidTitle="This link is no longer valid."
      invalidHelp="Please request a new invitation or password reset from your ClarityIQ administrator."
      successMessage="Your password has been updated."
    />
  );
}
