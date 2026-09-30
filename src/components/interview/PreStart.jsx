import { usePreStart } from "@hooks/interview/usePreStart";
import { PreStartRules } from "./PreStartRules";
import { PreStartCameraCheck } from "./PreStartCameraCheck";

export function PreStart({ onReady }) {
  const { step, limits, acknowledgeRules, finishCameraCheck } = usePreStart(onReady);
  if (step === "done") return null;

  return (
    <main
      aria-labelledby="pre-start-title"
      className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#7fb0ff_0%,#cfe1ff_38%,#eef5ff_72%,#ffffff_100%)] p-4"
    >
      {step === "rules" ? (
        <PreStartRules limits={limits} onAcknowledge={acknowledgeRules} />
      ) : (
        <PreStartCameraCheck onFinish={finishCameraCheck} />
      )}
    </main>
  );
}
