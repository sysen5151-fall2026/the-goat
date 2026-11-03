import { ConsumerAuthPage } from "@/components/auth/consumer-auth-page";
import { OnboardingGate } from "@/components/onboarding-gate";

export const metadata = {
  title: "Sign in | Wayly",
  description: "Sign in to Wayly to save NYC itineraries and exploration preferences.",
};

export default function LoginPage() {
  return <OnboardingGate><ConsumerAuthPage mode="login" /></OnboardingGate>;
}
