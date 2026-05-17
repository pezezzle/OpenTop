import { redirect } from "next/navigation";
import { completeProviderOauthAction } from "../../../actions";

export const dynamic = "force-dynamic";

interface OauthCallbackPageProps {
  searchParams?: Promise<{
    session?: string;
    providerId?: string;
    code?: string;
    error?: string;
    error_description?: string;
  }>;
}

export default async function OauthCallbackPage({ searchParams }: OauthCallbackPageProps) {
  const params = (await searchParams) ?? {};
  const sessionId = params.session?.trim() ?? "";
  const providerId = params.providerId?.trim() ?? "";
  const code = params.code?.trim() ?? "";
  const error = params.error?.trim() ?? "";
  const errorDescription = params.error_description?.trim() ?? "";

  if (!sessionId || !providerId) {
    redirect("/settings?oauth=error&message=Missing%20OAuth%20callback%20state");
  }

  try {
    await completeProviderOauthAction({
      providerId,
      sessionId,
      code: code || undefined,
      error: error || undefined,
      errorDescription: errorDescription || undefined
    });
    redirect(`/settings?oauth=connected&provider=${encodeURIComponent(providerId)}`);
  } catch (callbackError) {
    const message =
      callbackError instanceof Error ? callbackError.message : "OAuth connection could not be completed.";
    redirect(
      `/settings?oauth=error&provider=${encodeURIComponent(providerId)}&message=${encodeURIComponent(message)}`
    );
  }
}
