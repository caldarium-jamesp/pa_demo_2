import iconLogo from "./assets/logo_black.png";
import wordmarkLogo from "./assets/name_logo.png";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type CaseSummary = {
  case_id: string;
  patient_name: string;
  payer: string;
  cpt_code: string;
  status: string;
  created_at: string;
};

type DocumentSummary = {
  document_id: string;
  filename: string;
  created_at: string;
};

type CaseDetailResponse = {
  case: CaseSummary;
  documents: DocumentSummary[];
};

type DocumentDetailResponse = {
  document_id: string;
  filename: string;
  case_id: string;
  created_at: string;
  text: string;
};

type ConceptMatch = {
  concept_id: string;
  confidence: number;
  certainty_level: string | null;
  evidence_text: string;
  section: string;
};

type ClauseEvaluation = {
  clause_id: string;
  clause_type: string;
  status: boolean;
  policy_text: string;
  missing_concepts: string[];
  matched_concepts: ConceptMatch[];
};

type AnalysisResponse = {
  case_id: string;
  approval_clauses: ClauseEvaluation[];
  exclusion_clauses: ClauseEvaluation[];
};

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "/api";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatConceptLabel(conceptId: string): string {
  return conceptId
    .split("_")
    .map((word) => {
      if (/^\d+$/.test(word) || word.length === 0) {
        return word;
      }

      const normalized = word.toLowerCase();
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

function getStatusFromConfidence(confidence: number): string {
  if (confidence >= 0.9) {
    return "Present";
  }

  if (confidence >= 0.8) {
    return "Needs Review";
  }

  return "Missing";
}

function getStatusBadgeClasses(status: string): string {
  if (status === "Present") {
    return "border-[#6dffb5] bg-[#ecfff5]";
  }

  if (status === "Needs Review") {
    return "border-[#ffd08a] bg-[#fff6e8]";
  }

  return "border-[#ffc6c6] bg-[#fff1f1]";
}

async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  } catch {
    // Keep fallback for non-JSON error responses.
  }

  return fallback;
}

function App() {
  const [activePage, setActivePage] = useState<"cases" | "document" | "results">(
    "cases",
  );

  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetailResponse | null>(null);
  const [caseDetailLoading, setCaseDetailLoading] = useState(false);
  const [caseDetailError, setCaseDetailError] = useState<string | null>(null);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documentDetail, setDocumentDetail] = useState<DocumentDetailResponse | null>(
    null,
  );
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [createCaseLoading, setCreateCaseLoading] = useState(false);
  const [createCaseError, setCreateCaseError] = useState<string | null>(null);
  const [analysisResultsByCaseId, setAnalysisResultsByCaseId] = useState<
    Record<string, AnalysisResponse>
  >({});
  const [analysisLoadingByCaseId, setAnalysisLoadingByCaseId] = useState<
    Record<string, boolean>
  >({});
  const [analysisErrorByCaseId, setAnalysisErrorByCaseId] = useState<
    Record<string, string | null>
  >({});
  const [expandedResultRowIds, setExpandedResultRowIds] = useState<
    Record<string, boolean>
  >({});

  const selectedCase = useMemo(
    () => cases.find((caseItem) => caseItem.case_id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );
  const selectedCaseResult = useMemo(
    () => (selectedCaseId ? analysisResultsByCaseId[selectedCaseId] ?? null : null),
    [analysisResultsByCaseId, selectedCaseId],
  );
  const satisfiedClauses = useMemo(() => {
    if (!selectedCaseResult) {
      return [];
    }

    const approved = selectedCaseResult.approval_clauses.filter(
      (clause) => clause.status === true,
    );
    const excluded = selectedCaseResult.exclusion_clauses.filter(
      (clause) => clause.status === true,
    );

    return [...approved, ...excluded];
  }, [selectedCaseResult]);
  const matchedConceptRows = useMemo(
    () =>
      satisfiedClauses
        .flatMap((clause) =>
          clause.matched_concepts.map((match, matchIndex) => ({
            row_id: `${clause.clause_id}-${matchIndex}`,
            clause_id: clause.clause_id,
            section: match.section,
            concept_id: match.concept_id,
            confidence: match.confidence,
            evidence_text: match.evidence_text,
            policy_text: clause.policy_text,
          })),
        )
        .sort((a, b) => {
          const sectionCompare = (a.section || "").localeCompare(
            b.section || "",
            undefined,
            { sensitivity: "base" },
          );
          if (sectionCompare !== 0) {
            return sectionCompare;
          }

          return a.concept_id.localeCompare(b.concept_id, undefined, {
            sensitivity: "base",
          });
        }),
    [satisfiedClauses],
  );
  const selectedCaseAnalysisLoading = selectedCaseId
    ? analysisLoadingByCaseId[selectedCaseId] === true
    : false;
  const selectedCaseAnalysisError = selectedCaseId
    ? analysisErrorByCaseId[selectedCaseId] ?? null
    : null;

  const toggleResultRowExpanded = useCallback((rowId: string) => {
    setExpandedResultRowIds((current) => ({
      ...current,
      [rowId]: !current[rowId],
    }));
  }, []);

  const runCaseAnalysis = useCallback(async (caseId: string, payer?: string) => {
    setAnalysisLoadingByCaseId((current) => ({
      ...current,
      [caseId]: true,
    }));
    setAnalysisErrorByCaseId((current) => ({
      ...current,
      [caseId]: null,
    }));

    try {
      const query = new URLSearchParams();
      if (payer) {
        query.set("policy_name", payer);
      }

      const queryString = query.toString();
      const endpoint = queryString
        ? `${API_BASE_URL}/run_case/${caseId}?${queryString}`
        : `${API_BASE_URL}/run_case/${caseId}`;

      const response = await fetch(endpoint, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(
            response,
            `Failed to run case analysis (${response.status})`,
          ),
        );
      }

      const payload = (await response.json()) as AnalysisResponse;
      setAnalysisResultsByCaseId((current) => ({
        ...current,
        [payload.case_id]: payload,
      }));
    } catch (error) {
      setAnalysisErrorByCaseId((current) => ({
        ...current,
        [caseId]:
          error instanceof Error
            ? error.message
            : "Unable to run case analysis",
      }));
    } finally {
      setAnalysisLoadingByCaseId((current) => ({
        ...current,
        [caseId]: false,
      }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchCases() {
      setCasesLoading(true);
      setCasesError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/cases`);
        if (!response.ok) {
          throw new Error(`Failed to fetch cases (${response.status})`);
        }

        const payload = (await response.json()) as CaseSummary[];
        if (!cancelled) {
          setCases(payload);

          if (payload.length > 0 && !selectedCaseId) {
            setSelectedCaseId(payload[0].case_id);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCasesError(
            error instanceof Error ? error.message : "Unable to load cases",
          );
        }
      } finally {
        if (!cancelled) {
          setCasesLoading(false);
        }
      }
    }

    void fetchCases();

    return () => {
      cancelled = true;
    };
  }, [selectedCaseId]);

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseDetail(null);
      return;
    }

    let cancelled = false;

    async function fetchCaseDetail() {
      setCaseDetailLoading(true);
      setCaseDetailError(null);
      setDocumentDetail(null);
      setSelectedDocumentId(null);

      try {
        const response = await fetch(`${API_BASE_URL}/cases/${selectedCaseId}`);
        if (!response.ok) {
          throw new Error(`Failed to load case detail (${response.status})`);
        }

        const payload = (await response.json()) as CaseDetailResponse;

        if (!cancelled) {
          setCaseDetail(payload);

          const firstDocument = payload.documents[0];
          if (firstDocument) {
            setSelectedDocumentId(firstDocument.document_id);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCaseDetailError(
            error instanceof Error ? error.message : "Unable to load case detail",
          );
        }
      } finally {
        if (!cancelled) {
          setCaseDetailLoading(false);
        }
      }
    }

    void fetchCaseDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedCaseId]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setDocumentDetail(null);
      return;
    }

    let cancelled = false;

    async function fetchDocumentDetail() {
      setDocumentLoading(true);
      setDocumentError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/documents/${selectedDocumentId}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to load document (${response.status})`);
        }

        const payload = (await response.json()) as DocumentDetailResponse;

        if (!cancelled) {
          setDocumentDetail(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setDocumentError(
            error instanceof Error ? error.message : "Unable to load document",
          );
        }
      } finally {
        if (!cancelled) {
          setDocumentLoading(false);
        }
      }
    }

    void fetchDocumentDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId]);

  useEffect(() => {
    if (
      activePage !== "results" ||
      !selectedCaseId ||
      selectedCaseResult ||
      selectedCaseAnalysisLoading
    ) {
      return;
    }

    void runCaseAnalysis(selectedCaseId, selectedCase?.payer);
  }, [
    activePage,
    runCaseAnalysis,
    selectedCase?.payer,
    selectedCaseAnalysisLoading,
    selectedCaseId,
    selectedCaseResult,
  ]);

  useEffect(() => {
    setExpandedResultRowIds({});
  }, [selectedCaseId]);

  async function uploadNewCase(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    setCreateCaseLoading(true);
    setCreateCaseError(null);

    try {
      const formData = new FormData();
      Array.from(fileList).forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(`${API_BASE_URL}/analyze_files`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(
            response,
            `Failed to create case (${response.status})`,
          ),
        );
      }

      const payload = (await response.json()) as AnalysisResponse;
      setAnalysisResultsByCaseId((currentResults) => ({
        ...currentResults,
        [payload.case_id]: payload,
      }));
      setAnalysisErrorByCaseId((current) => ({
        ...current,
        [payload.case_id]: null,
      }));
      setSelectedCaseId(payload.case_id);
      setActivePage("results");
    } catch (error) {
      setCreateCaseError(
        error instanceof Error ? error.message : "Unable to create case",
      );
    } finally {
      setCreateCaseLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen px-6 py-10 text-[#414042] sm:px-10"
      style={{
        fontFamily:
          '"Space Grotesk", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        background:
          "radial-gradient(1100px 700px at 15% 0%, rgba(109, 255, 181, 0.12), transparent 60%), radial-gradient(900px 650px at 85% 5%, rgba(0, 255, 125, 0.14), transparent 55%), linear-gradient(180deg, #ffffff 0%, #f3f3f4 45%, #e6e7e8 100%)",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00ff7d] p-2 shadow-[0_0_20px_rgba(0,255,125,0.35)]">
                <img src={iconLogo} alt="Company icon" className="h-8 w-8" />
              </div>
              <img src={wordmarkLogo} alt="Company logo" className="h-10 w-auto" />
            </div>
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.35em] text-[#808184]">
              <span>Backend</span>
              <span className="h-2 w-2 rounded-full bg-[#6dffb5]" />
              <span>{API_BASE_URL}</span>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col gap-6">
              <h1 className="text-4xl font-semibold text-[#2e2d30] sm:text-5xl">
                {activePage === "cases"
                  ? "Choose a preloaded case or upload a new case by selecting the case documents."
                    : activePage === "document"
                      ? "Inspect case documents directly from the backend."
                      : "Review approval and exclusion clause status."}
              </h1>
              {activePage === "cases" && (
                <p className="max-w-2xl text-base text-[#808184]">
                  Two cases have been preloaded from the backend for convenience.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-4">
                {activePage === "document" && (
                  <button
                    type="button"
                    onClick={() => setActivePage("results")}
                    className="rounded-full bg-[#00ff7d] px-6 py-3 text-sm font-semibold text-[#414042] shadow-[0_10px_25px_rgba(0,255,125,0.3)] transition hover:-translate-y-0.5 hover:bg-[#6dffb5]"
                  >
                    Open results page
                  </button>
                )}
                {activePage === "results" && (
                  <button
                    type="button"
                    onClick={() => setActivePage("document")}
                    className="rounded-full border border-[#e0e0e2] bg-white px-6 py-3 text-sm font-semibold text-[#414042] transition hover:border-[#6dffb5]"
                  >
                    Open document viewer
                  </button>
                )}
                {activePage !== "cases" && (
                  <button
                    type="button"
                    onClick={() => setActivePage("cases")}
                    className="rounded-full border border-[#e0e0e2] bg-white px-6 py-3 text-sm font-semibold text-[#414042] transition hover:border-[#6dffb5]"
                  >
                    Back to case list
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {activePage === "cases" ? (
          <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <article className="group flex h-full flex-col gap-6 rounded-3xl border border-[#e0e0e2] bg-white/90 p-6 shadow-[0_18px_35px_rgba(65,64,66,0.15)] transition hover:-translate-y-1 hover:border-[#6dffb5] hover:shadow-[0_18px_40px_rgba(0,255,125,0.2)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#2e2d30]">
                    Start a New Case by Uploading Docs
                  </h2>
                  <p className="mt-1 text-sm text-[#808184]">
                    Upload one or more files for analysis.
                  </p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void uploadNewCase(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={createCaseLoading}
                className="mt-auto inline-flex items-center justify-center rounded-full bg-[#00ff7d] px-4 py-2 text-sm font-semibold text-[#414042] transition hover:bg-[#6dffb5] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {createCaseLoading ? "Uploading..." : "Select documents"}
              </button>

              {createCaseError && (
                <p className="rounded-xl border border-[#ffd4d4] bg-[#fff5f5] p-3 text-sm text-[#9b2c2c]">
                  {createCaseError}
                </p>
              )}
            </article>

            {casesLoading && (
              <p className="col-span-full rounded-2xl border border-[#e0e0e2] bg-white/90 p-6 text-sm">
                Loading cases...
              </p>
            )}

            {casesError && (
              <p className="col-span-full rounded-2xl border border-[#ffd4d4] bg-[#fff5f5] p-6 text-sm text-[#9b2c2c]">
                {casesError}
              </p>
            )}

            {!casesLoading && !casesError && cases.length === 0 && (
              <p className="col-span-full rounded-2xl border border-[#e0e0e2] bg-white/90 p-6 text-sm">
                No cases returned by the API yet.
              </p>
            )}

            {cases.map((caseItem) => (
              <article
                key={caseItem.case_id}
                className="group flex h-full flex-col gap-6 rounded-3xl border border-[#e0e0e2] bg-white/90 p-6 shadow-[0_18px_35px_rgba(65,64,66,0.15)] transition hover:-translate-y-1 hover:border-[#6dffb5] hover:shadow-[0_18px_40px_rgba(0,255,125,0.2)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                <h2 className="text-lg font-semibold text-[#2e2d30]">
                  {caseItem.patient_name || "Unknown patient"}
                </h2>
                <p className="text-sm text-[#808184]">Payer: {caseItem.payer}</p>
                <p className="text-sm text-[#808184]">Status: {caseItem.status}</p>
              </div>
              <span className="rounded-full border border-[#6dffb5] bg-[#f3fff8] px-3 py-1 text-xs font-semibold text-[#2e2d30]">
                CPT {caseItem.cpt_code}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedCaseId(caseItem.case_id);
                    setActivePage("document");
                  }}
                  className="mt-auto inline-flex items-center justify-center rounded-full border border-[#e0e0e2] bg-white px-4 py-2 text-sm font-semibold text-[#414042] transition hover:border-[#6dffb5]"
                >
                  Open Docs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCaseId(caseItem.case_id);
                    setActivePage("results");
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-[#00ff7d] px-4 py-2 text-sm font-semibold text-[#414042] transition hover:bg-[#6dffb5]"
                >
                  {(analysisResultsByCaseId[caseItem.case_id] ||
                    caseItem.status.toLowerCase() === "approved" ||
                    caseItem.status.toLowerCase() === "denied")
                    ? "Open Results"
                    : "Run Case"}
                </button>
              </article>
            ))}
          </section>
        ) : activePage === "document" ? (
          <section className="rounded-3xl border border-[#e0e0e2] bg-white/90 p-6 shadow-[0_18px_35px_rgba(65,64,66,0.15)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[#808184]">Document contents</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#2e2d30]">
                  {selectedCase
                    ? `${selectedCase.patient_name || "Unknown patient"}`
                    : "Select a case from the case list"}
                </h2>
              </div>
              {selectedCase && (
                <span className="rounded-full border border-[#6dffb5] bg-[#f3fff8] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[#2e2d30]">
                  {selectedCase.payer}
                </span>
              )}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
              <aside className="rounded-2xl border border-[#e0e0e2] bg-[#f8f8f9] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#808184]">
                  Documents
                </h3>

                {caseDetailLoading && <p className="mt-4 text-sm">Loading case details...</p>}

                {caseDetailError && (
                  <p className="mt-4 rounded-xl border border-[#ffd4d4] bg-[#fff5f5] p-3 text-sm text-[#9b2c2c]">
                    {caseDetailError}
                  </p>
                )}

                {!caseDetailLoading && !caseDetailError && caseDetail?.documents.length === 0 && (
                  <p className="mt-4 text-sm text-[#808184]">No documents available for this case.</p>
                )}

                <div className="mt-4 flex max-h-[350px] flex-col gap-2 overflow-auto">
                  {caseDetail?.documents.map((doc) => (
                    <button
                      key={doc.document_id}
                      type="button"
                      onClick={() => setSelectedDocumentId(doc.document_id)}
                      className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                        selectedDocumentId === doc.document_id
                          ? "border-[#00ff7d] bg-[#ecfff5]"
                          : "border-[#d7d8da] bg-white hover:border-[#6dffb5]"
                      }`}
                    >
                      <p className="font-medium text-[#2e2d30]">{doc.filename}</p>
                      <p className="mt-1 text-xs text-[#808184]">{formatDate(doc.created_at)}</p>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="rounded-2xl border border-[#e0e0e2] bg-[#f8f8f9] p-6 shadow-inner">
                {documentLoading && <p className="text-sm">Loading document...</p>}

                {documentError && (
                  <p className="rounded-xl border border-[#ffd4d4] bg-[#fff5f5] p-3 text-sm text-[#9b2c2c]">
                    {documentError}
                  </p>
                )}

                {!documentLoading && !documentError && !documentDetail && (
                  <p className="text-sm text-[#808184]">Choose a document to view its contents.</p>
                )}

                {documentDetail && (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[#2e2d30]">{documentDetail.filename}</p>
                      <span className="text-xs uppercase tracking-[0.2em] text-[#808184]">
                        {formatDate(documentDetail.created_at)}
                      </span>
                    </div>
                    <div className="max-h-[420px] overflow-y-auto rounded-xl border border-[#e0e0e2] bg-white p-4 text-sm leading-relaxed text-[#414042]">
                      <pre className="whitespace-pre-wrap font-sans">{documentDetail.text}</pre>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-[#e0e0e2] bg-white/90 p-6 shadow-[0_18px_35px_rgba(65,64,66,0.15)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[#808184]">
                  Case results
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#808184]">
                  CPT-72148
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#2e2d30]">
                  {selectedCase
                    ? `${selectedCase.patient_name || "Unknown patient"}`
                    : "Select a case from the case list"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {selectedCase && (
                  <span className="rounded-full border border-[#6dffb5] bg-[#f3fff8] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[#2e2d30]">
                    {selectedCase.payer}
                  </span>
                )}
                {selectedCaseId && (
                  <button
                    type="button"
                    onClick={() =>
                      void runCaseAnalysis(selectedCaseId, selectedCase?.payer)
                    }
                    disabled={selectedCaseAnalysisLoading}
                    className="rounded-full border border-[#e0e0e2] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#414042] transition hover:border-[#6dffb5] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {selectedCaseAnalysisLoading
                      ? "Running..."
                      : selectedCaseResult
                        ? "RUN AGAIN"
                        : "RUN CASE"}
                  </button>
                )}
              </div>
            </div>

            {!selectedCaseId && (
              <p className="mt-6 rounded-xl border border-[#e0e0e2] bg-[#f8f8f9] p-4 text-sm text-[#808184]">
                Choose a case to view results.
              </p>
            )}

            {selectedCaseId && selectedCaseAnalysisLoading && (
              <p className="mt-6 rounded-xl border border-[#e0e0e2] bg-[#f8f8f9] p-4 text-sm text-[#808184]">
                Running case analysis via <code>POST /run_case</code>...
              </p>
            )}

            {selectedCaseId && selectedCaseAnalysisError && (
              <p className="mt-6 rounded-xl border border-[#ffd4d4] bg-[#fff5f5] p-4 text-sm text-[#9b2c2c]">
                {selectedCaseAnalysisError}
              </p>
            )}

            {selectedCaseId &&
              !selectedCaseResult &&
              !selectedCaseAnalysisLoading &&
              !selectedCaseAnalysisError && (
              <p className="mt-6 rounded-xl border border-[#e0e0e2] bg-[#f8f8f9] p-4 text-sm text-[#808184]">
                No analysis result is available for this case yet.
              </p>
            )}

            {selectedCaseResult && satisfiedClauses.length === 0 && (
              <p className="mt-6 rounded-xl border border-[#e0e0e2] bg-[#f8f8f9] p-4 text-sm text-[#808184]">
                No clauses with <code>status = true</code> were returned for this
                case.
              </p>
            )}

            {selectedCaseResult && satisfiedClauses.length > 0 && matchedConceptRows.length === 0 && (
              <p className="mt-6 rounded-xl border border-[#e0e0e2] bg-[#f8f8f9] p-4 text-sm text-[#808184]">
                No matched concepts were returned for clauses with <code>status = true</code>.
              </p>
            )}

            {selectedCaseResult && matchedConceptRows.length > 0 && (
              <div className="mt-6 overflow-x-auto rounded-2xl border border-[#e0e0e2] bg-[#f8f8f9]">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#e0e0e2] bg-white">
                      <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-[#808184]">
                        Document
                      </th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-[#808184]">
                        Concept
                      </th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-[#808184]">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedConceptRows.map((row, index) => {
                      const status = getStatusFromConfidence(Number(row.confidence));

                      return (
                        <Fragment key={`${row.row_id}-${index}`}>
                          <tr
                            onClick={() => toggleResultRowExpanded(row.row_id)}
                            className="cursor-pointer border-b border-[#e0e0e2] transition hover:bg-white"
                          >
                            <td className="px-4 py-3 text-[#414042]">
                              <span className="mr-2 inline-block w-4 text-[#808184]">
                                {expandedResultRowIds[row.row_id] ? "-" : "+"}
                              </span>
                              {row.section || "-"}
                            </td>
                            <td className="px-4 py-3 text-[#414042]">
                              {formatConceptLabel(row.concept_id)}
                            </td>
                            <td className="px-4 py-3 text-[#414042]">
                              <span
                                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#2e2d30] ${getStatusBadgeClasses(status)}`}
                              >
                                {status}
                              </span>
                            </td>
                          </tr>
                          {expandedResultRowIds[row.row_id] && (
                            <tr className="border-b border-[#e0e0e2] bg-white/70">
                              <td colSpan={3} className="px-4 py-3 text-[#414042]">
                                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#808184]">
                                  Evidence Text
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-[#414042]">
                                  {row.evidence_text || "-"}
                                </p>
                                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#808184]">
                                  Policy Text
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-[#414042]">
                                  {row.policy_text || "-"}
                                </p>
                                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#808184]">
                                  Confidence Score
                                </p>
                                <p className="mt-1 text-sm text-[#414042]">
                                  {Number(row.confidence).toFixed(2)}
                                </p>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default App;
