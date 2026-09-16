"use client";

import { useState } from "react";
import {
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useClerk,
  useOrganization,
  useUser,
} from "@clerk/nextjs";

function CreateOrganizationButton() {
  const clerk = useClerk();
  const { organization } = useOrganization();
  // OrganizationSwitcher's own "create organization" entry can be hidden by Clerk dashboard
  // permission settings, so this button is a guaranteed fallback entry point.
  if (organization) return null;
  return (
    <button
      className="auth-button primary"
      type="button"
      onClick={() => clerk.openCreateOrganization({ afterCreateOrganizationUrl: "/" })}
    >
      Create organization
    </button>
  );
}

function ConnectGitHubButton() {
  const { user } = useUser();
  const [pending, setPending] = useState(false);
  const githubAccount = user?.externalAccounts.find((account) => account.provider === "github");

  if (githubAccount)
    return (
      <span className="auth-github-status" title="GitHub account linked">
        GitHub: @{githubAccount.username}
      </span>
    );

  const connect = async () => {
    if (!user || pending) return;
    setPending(true);
    try {
      const account = await user.createExternalAccount({
        strategy: "oauth_github",
        redirectUrl: "/sso-callback",
      });
      const redirectUrl = account.verification?.externalVerificationRedirectURL;
      if (redirectUrl) window.location.href = redirectUrl.toString();
    } finally {
      setPending(false);
    }
  };

  return (
    <button className="auth-button" type="button" disabled={pending} onClick={() => void connect()}>
      {pending ? "Connecting..." : "Connect GitHub"}
    </button>
  );
}

export function AuthControls() {
  return (
    <div className="auth-controls" aria-label="Account controls">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="auth-button" type="button">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="auth-button primary" type="button">
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        {/* hidePersonal: the hosted app requires an org (tenant), personal accounts have no tenant */}
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl="/"
          afterSelectOrganizationUrl="/"
          afterLeaveOrganizationUrl="/"
        />
        <CreateOrganizationButton />
        <ConnectGitHubButton />
        <UserButton />
      </Show>
    </div>
  );
}
