import AnsweringServicePage from "@/pages/user/AnsweringServicePage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/user/answering")({
  component: AnsweringServicePage,
});
