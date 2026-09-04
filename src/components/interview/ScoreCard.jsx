import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { stopProctoringOnce } from "@/lib/electronRecording";
import {
  CheckCircle2,
  TrendingUp,
  Brain,
  MessageSquare,
  Target,
  Zap,
  Lightbulb,
  ThumbsUp,
  ChevronRight,
  BarChart,
  MessageCircle,
  AlertTriangle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import QuestionContent from "./QuestionContent";
import CodeBlock from "./CodeBlock";

// Question types whose answer is a code snippet (render in a code block).
const CODE_TYPES = new Set(["CODE", "CODING", "PSEUDO_CODE", "SUDO_CODE"]);

// A beautiful, animated circular progress ring component
function CircularProgress({ value }) {
  const { t } = useTranslation("interview");
  const [animatedValue, setAnimatedValue] = useState(0);
  useEffect(() => {
    // Small delay to ensure the animation triggers after mount
    const t = setTimeout(() => setAnimatedValue(value), 100);
    return () => clearTimeout(t);
  }, [value]);

  const radius = 90;
  const stroke = 16;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (animatedValue / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center">
      {/* Subtle glow behind the circle */}
      <div className="absolute inset-0 rounded-full bg-blue-400/10 blur-2xl" />

      <svg height={radius * 2} width={radius * 2} className="-rotate-90 transform">
        <circle
          stroke="#f1f5f9" // slate-100
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="url(#blue-gradient)"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + " " + circumference}
          style={{
            strokeDashoffset,
            transition: "stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <defs>
          <linearGradient id="blue-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" /> {/* blue-500 */}
            <stop offset="100%" stopColor="#2563eb" /> {/* blue-600 */}
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <div className="flex items-baseline">
          <span className="text-5xl font-black tracking-tighter text-slate-800">
            {animatedValue}
          </span>
          <span className="text-2xl font-bold text-blue-600">%</span>
        </div>
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
          {t("scoreCard.score")}
        </span>
      </div>
    </div>
  );
}

export default function ScoreCard({ scorecard }) {
  const { t } = useTranslation("interview");
  // ScoreCard mounting = the result screen is visible, so the score is on the
  // recording before it ends.
  useEffect(() => {
    stopProctoringOnce();
  }, []);

  if (!scorecard) return null;

  const {
    overall_score,
    comm_metrics,
    strengths,
    areas_for_improvement,
    recommendations,
    question_breakdown,
  } = scorecard;

  const displayQuestions = [];

  for (const qa of question_breakdown ?? []) {
    if (qa.type === "AUDIO" && qa.is_dummy_audio) break;
    if (qa.type !== "AUDIO" && qa.answer_provided === "") break;
    displayQuestions.push(qa);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      {/* Header Section */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-500 p-10 text-center text-white shadow-lg">
        {/* Decorative background blobs */}
        <div className="absolute -start-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -end-20 h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative z-10">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20 shadow-inner backdrop-blur-md">
            <CheckCircle2 className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t("scoreCard.heading")}
          </h1>
          <p className="mt-3 text-lg font-medium text-blue-100">{t("scoreCard.subheading")}</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* ROW 1: Overall Score & Metrics */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Overall Score Card */}
          <div className="col-span-1 flex flex-col items-center justify-center rounded-3xl border border-slate-100 bg-white p-10 text-center shadow-sm">
            <CircularProgress value={overall_score} />
            <h3 className="mt-6 text-xl font-bold text-slate-800">
              {t("scoreCard.overallPerformance")}
            </h3>
            <p className="mt-2 text-sm text-slate-500">{t("scoreCard.overallPerformanceDesc")}</p>
          </div>

          {/* Detailed Metrics */}
          <div className="col-span-1 rounded-3xl border border-slate-100 bg-white p-8 shadow-sm lg:col-span-2">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <BarChart className="h-5 w-5" />
              </div>
              <h3 className="text-xl font-bold text-slate-800">
                {t("scoreCard.communicationMetrics")}
              </h3>
            </div>
            {/* Split metrics into two columns for better utilization of space */}
            <div className="grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2">
              <MetricRow
                icon={MessageSquare}
                label={t("scoreCard.metricClarity")}
                value={comm_metrics?.clarity}
                color="bg-indigo-500"
              />
              <MetricRow
                icon={Zap}
                label={t("scoreCard.metricConfidence")}
                value={comm_metrics?.confidence}
                color="bg-blue-500"
              />
              <MetricRow
                icon={Target}
                label={t("scoreCard.metricRelevance")}
                value={comm_metrics?.relevance}
                color="bg-emerald-500"
              />
              <MetricRow
                icon={Brain}
                label={t("scoreCard.metricDepthOfThought")}
                value={comm_metrics?.depth_of_thought}
                color="bg-violet-500"
              />
              <MetricRow
                icon={Lightbulb}
                label={t("scoreCard.metricKeyConcepts")}
                value={comm_metrics?.key_concept_coverage}
                color="bg-amber-500"
              />
            </div>
          </div>
        </div>

        {/* ROW 2: Feedback Details */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Strengths */}
          <div className="rounded-3xl border border-emerald-100 bg-gradient-to-b from-emerald-50/50 to-white p-8 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <ThumbsUp className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-emerald-900">{t("scoreCard.keyStrengths")}</h3>
            </div>
            <ul className="space-y-4">
              {strengths?.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-[15px] leading-relaxed text-emerald-800"
                >
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Improvements */}
          <div className="rounded-3xl border border-rose-100 bg-gradient-to-b from-rose-50/50 to-white p-8 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <TrendingUp className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold text-rose-900">{t("scoreCard.needsImprovement")}</h3>
            </div>
            <ul className="space-y-4">
              {areas_for_improvement?.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-[15px] leading-relaxed text-rose-800"
                >
                  <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-rose-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Recommendations */}
          <div className="rounded-3xl border border-blue-100 bg-gradient-to-b from-blue-50/50 to-white p-8 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <Lightbulb className="h-5 w-5 fill-current" />
              </div>
              <h3 className="text-lg font-bold text-blue-900">{t("scoreCard.recommendations")}</h3>
            </div>
            <ul className="space-y-4">
              {recommendations?.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-[15px] leading-relaxed text-blue-800"
                >
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-blue-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ROW 3: Question Breakdown */}
        <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <MessageCircle className="h-5 w-5" />
            </div>
            <h3 className="text-xl font-bold text-slate-800">{t("scoreCard.questionBreakdown")}</h3>
          </div>

          <div className="space-y-6">
            {displayQuestions?.map((q, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/50 transition-colors hover:border-blue-100"
              >
                {/* Header Row */}
                <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 bg-white p-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                      {q.question_number}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {q.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                        q.is_correct
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {q.is_correct ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("scoreCard.correct")}
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5" /> {t("scoreCard.incorrect")}
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="space-y-4 p-5 text-[15px]">
                  <div>
                    <h4 className="font-semibold text-slate-800">{t("scoreCard.question")}</h4>
                    <QuestionContent source={q.question_text} className="mt-1 text-slate-600" />
                  </div>

                  {q.code_snippet && (
                    <div>
                      <h4 className="mb-1 font-semibold text-slate-800">
                        {t("scoreCard.codeSnippet")}
                      </h4>
                      <CodeBlock code={q.code_snippet} />
                    </div>
                  )}

                  <div>
                    <div className="rounded-xl bg-white p-4 shadow-sm border border-slate-100">
                      <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
                        {t("scoreCard.yourAnswer")}
                      </span>
                      {q.type === "AUDIO" ? (
                        q.candidate_audio_file_url && (
                          <audio
                            controls
                            src={q.candidate_audio_file_url}
                            className="mt-2 w-full"
                          />
                        )
                      ) : CODE_TYPES.has((q.type || "").toUpperCase()) && q.answer_provided ? (
                        <CodeBlock code={q.answer_provided} />
                      ) : (
                        <p className="text-slate-700">
                          {q.answer_provided || t("scoreCard.noAnswerProvided")}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* {q.feedback && (
                    <div
                      className={`mt-2 rounded-xl p-4 text-sm ${q.is_correct ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"}`}
                    >
                      <span className="font-semibold">Feedback: </span>
                      {q.feedback}
                    </div>
                  )} */}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ icon: Icon, label, value = 0, color = "bg-blue-500" }) {
  const [animatedValue, setAnimatedValue] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimatedValue(value), 300);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[15px]">
        <div className="flex items-center gap-2.5 text-slate-600">
          <Icon className="h-4 w-4 text-slate-400" />
          <span className="font-medium">{label}</span>
        </div>
        <span className="font-bold text-slate-800">{Math.round(animatedValue)}%</span>
      </div>
      {/* Overriding the default indicator color with our prop */}
      <Progress
        value={animatedValue}
        className="h-2.5 bg-slate-100"
        indicatorClassName={`${color} transition-all duration-1000 ease-out`}
      />
    </div>
  );
}
