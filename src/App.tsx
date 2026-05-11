import wordmarkLogo from "./assets/name_logo.png";
import checkIcon from "./assets/check.png";
import crossIcon from "./assets/cross.png";
import cautionIcon from "./assets/caution.png";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  status: string;
  policy_text: string;
  missing_concepts: string[];
  matched_concepts: ConceptMatch[];
};

type EvidenceClause = {
  clause_id: string;
  policy_text: string;
  status: string;
};

type EvidenceCategoryReview = {
  evidence_category: string;
  status: string;
  clauses: EvidenceClause[];
};

type AnalysisResponse = {
  case_id: string;
  evidence_review?: EvidenceCategoryReview[];
  approval_clauses: ClauseEvaluation[];
  exclusion_clauses?: ClauseEvaluation[];
  pa_required?: boolean;
  coverage_status?: string;
  evaluation_summary?: string;
  evaluation_result_summary?: string;
  evaluation_rule?: { display?: string };
};

type UploadFilesResponse = {
  case_id: string;
  message: string;
};

type PARequiredResponse = {
  payer: string;
  cpt_code: string;
  pa_required: boolean;
  message: string;
};

type CreateCaseFormValues = {
  patientName: string;
  payer: "" | "Aetna" | "Humana";
  cptCode: string;
};

type CreateCaseFormErrors = {
  payer?: string;
  cptCode?: string;
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

function formatPayerLabel(payer: string): string {
  if (!payer) {
    return payer;
  }

  const normalized = payer.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCaseStatusLabel(status: string): string {
  if (!status) {
    return status;
  }

  const normalized = status.toLowerCase();

  if (normalized === "not_covered:non_covered") {
    return "Not Covered";
  }

  if (normalized === "no_pa_required") {
    return "No PA Required";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
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

function validateCreateCaseForm(
  values: CreateCaseFormValues,
): CreateCaseFormErrors {
  const errors: CreateCaseFormErrors = {};

  if (!values.payer) {
    errors.payer = "Choose a payer.";
  }

  if (!values.cptCode.trim()) {
    errors.cptCode = "Enter a CPT code.";
  } else if (!/^[a-z0-9]+$/i.test(values.cptCode.trim())) {
    errors.cptCode = "CPT code must be alphanumeric.";
  }

  return errors;
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
  const [isCreateCaseModalOpen, setIsCreateCaseModalOpen] = useState(false);
  const [createCaseForm, setCreateCaseForm] = useState<CreateCaseFormValues>({
    patientName: "Unknown",
    payer: "",
    cptCode: "",
  });
  const [createCaseFormErrors, setCreateCaseFormErrors] = useState<
    CreateCaseFormErrors
  >({});
  const [paCheckLoading, setPaCheckLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"simple" | "detailed">("simple");
  const [expandedClauseIds, setExpandedClauseIds] = useState<Record<string, boolean>>({});
  const [unsatisfiedClausesExpanded, setUnsatisfiedClausesExpanded] = useState(false);
  const [paNotRequiredResult, setPaNotRequiredResult] = useState<PARequiredResponse | null>(null);
  const [analysisResultsByCaseId, setAnalysisResultsByCaseId] = useState<
    Record<string, AnalysisResponse>
  >({});
  const [analysisLoadingByCaseId, setAnalysisLoadingByCaseId] = useState<
    Record<string, boolean>
  >({});
  const [analysisErrorByCaseId, setAnalysisErrorByCaseId] = useState<
    Record<string, string | null>
  >({});

  const selectedCase = useMemo(
    () => cases.find((caseItem) => caseItem.case_id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );
  const selectedCaseResult = useMemo(
    () => (selectedCaseId ? analysisResultsByCaseId[selectedCaseId] ?? null : null),
    [analysisResultsByCaseId, selectedCaseId],
  );
  const selectedCaseAnalysisLoading = selectedCaseId
    ? analysisLoadingByCaseId[selectedCaseId] === true
    : false;
  const selectedCaseAnalysisError = selectedCaseId
    ? analysisErrorByCaseId[selectedCaseId] ?? null
    : null;

  const runCaseAnalysis = useCallback(async (caseId: string) => {
    setAnalysisLoadingByCaseId((current) => ({
      ...current,
      [caseId]: true,
    }));
    setAnalysisErrorByCaseId((current) => ({
      ...current,
      [caseId]: null,
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/run_case/${caseId}`, {
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

  const fetchCases = useCallback(async () => {
    setCasesLoading(true);
    setCasesError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/cases`);
      if (!response.ok) {
        throw new Error(`Failed to fetch cases (${response.status})`);
      }

      const payload = (await response.json()) as CaseSummary[];
      setCases(payload);
      setSelectedCaseId((current) => {
        if (payload.length === 0) {
          return null;
        }

        if (current && payload.some((caseItem) => caseItem.case_id === current)) {
          return current;
        }

        return payload[0].case_id;
      });
    } catch (error) {
      setCasesError(
        error instanceof Error ? error.message : "Unable to load cases",
      );
    } finally {
      setCasesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

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

    void runCaseAnalysis(selectedCaseId);
  }, [
    activePage,
    runCaseAnalysis,
    selectedCaseAnalysisLoading,
    selectedCaseId,
    selectedCaseResult,
  ]);

  useEffect(() => {
    setExpandedClauseIds({});
    setUnsatisfiedClausesExpanded(false);
  }, [selectedCaseId]);

  const handleBackToCaseList = useCallback(() => {
    setActivePage("cases");
    void fetchCases();
  }, [fetchCases]);

  function openCreateCaseModal() {
    setCreateCaseError(null);
    setCreateCaseFormErrors({});
    setIsCreateCaseModalOpen(true);
  }

  function closeCreateCaseModal() {
    if (createCaseLoading) {
      return;
    }

    setIsCreateCaseModalOpen(false);
  }

  function handleCreateCaseFieldChange(
    field: keyof CreateCaseFormValues,
    value: string,
  ) {
    setCreateCaseForm((current) => ({
      ...current,
      [field]: value,
    }));
    setCreateCaseFormErrors((current) => ({
      ...current,
      [field === "payer" ? "payer" : field === "cptCode" ? "cptCode" : field]:
        undefined,
    }));
  }

  async function handleCreateCaseDetailsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validateCreateCaseForm(createCaseForm);
    if (Object.keys(errors).length > 0) {
      setCreateCaseFormErrors(errors);
      return;
    }

    setCreateCaseFormErrors({});
    setPaCheckLoading(true);

    try {
      const queryParams = new URLSearchParams({
        payer: createCaseForm.payer,
        cpt_code: createCaseForm.cptCode.trim(),
      });
      const response = await fetch(`${API_BASE_URL}/prior-auth-required?${queryParams.toString()}`);
      if (response.ok) {
        const paResult = (await response.json()) as PARequiredResponse;
        if (!paResult.pa_required) {
          setIsCreateCaseModalOpen(false);
          setPaNotRequiredResult(paResult);
          return;
        }
      }
    } catch {
      // PA check failed — proceed normally
    } finally {
      setPaCheckLoading(false);
    }

    setIsCreateCaseModalOpen(false);
    fileInputRef.current?.click();
  }

  async function uploadNewCase(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const normalizedForm = {
      patientName: createCaseForm.patientName.trim() || "Unknown",
      payer: createCaseForm.payer,
      cptCode: createCaseForm.cptCode.trim(),
    };
    const validationErrors = validateCreateCaseForm({
      patientName: normalizedForm.patientName,
      payer: normalizedForm.payer,
      cptCode: normalizedForm.cptCode,
    });

    if (Object.keys(validationErrors).length > 0) {
      setCreateCaseFormErrors(validationErrors);
      setIsCreateCaseModalOpen(true);
      return;
    }

    setCreateCaseLoading(true);
    setCreateCaseError(null);

    try {
      const formData = new FormData();
      Array.from(fileList).forEach((file) => {
        formData.append("files", file);
      });

      const queryParams = new URLSearchParams({
        patient_name: normalizedForm.patientName,
        payer: normalizedForm.payer,
        cpt_code: normalizedForm.cptCode,
      });

      const response = await fetch(`${API_BASE_URL}/upload_files?${queryParams.toString()}`, {
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

      const payload = (await response.json()) as UploadFilesResponse;
      setAnalysisErrorByCaseId((current) => ({
        ...current,
        [payload.case_id]: null,
      }));
      await fetchCases();
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
              <h1 className={`font-semibold text-[#2e2d30] ${activePage === "results" ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl"}`}>
                {activePage === "cases"
                  ? "Choose a preloaded case or upload a new case by selecting the case documents."
                    : activePage === "document"
                      ? "Inspect case documents directly from the backend."
                      : "Review summary of case analysis."}
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
                    onClick={handleBackToCaseList}
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
                onClick={openCreateCaseModal}
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
                <p className="text-sm text-[#808184]">Payer: {formatPayerLabel(caseItem.payer)}</p>
                <p className="text-sm text-[#808184]">Status: {formatCaseStatusLabel(caseItem.status)}</p>
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
                  {formatPayerLabel(selectedCase.payer)}
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
                <h2 className="mt-2 text-2xl font-semibold text-[#2e2d30]">
                  {selectedCase
                    ? `${selectedCase.patient_name || "Unknown patient"}`
                    : "Select a case from the case list"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {selectedCase && (
                  <>
                    <span className="rounded-full border border-[#e0e0e2] bg-[#f8f8f9] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[#2e2d30]">
                      CPT {selectedCase.cpt_code}
                    </span>
                    <span className="rounded-full border border-[#6dffb5] bg-[#f3fff8] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[#2e2d30]">
                      {formatPayerLabel(selectedCase.payer)}
                    </span>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold uppercase tracking-[0.2em] transition-colors ${viewMode === "simple" ? "text-[#2e2d30]" : "text-[#b0b0b3]"}`}>
                    Simple
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewMode(v => v === "simple" ? "detailed" : "simple")}
                    aria-label="Toggle view mode"
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                      viewMode === "detailed" ? "bg-[#00ff7d]" : "bg-[#d1d1d6]"
                    }`}
                  >
                    <span
                      className={`absolute h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        viewMode === "detailed" ? "translate-x-[22px]" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className={`text-xs font-semibold uppercase tracking-[0.2em] transition-colors ${viewMode === "detailed" ? "text-[#2e2d30]" : "text-[#b0b0b3]"}`}>
                    Detailed
                  </span>
                </div>
                {selectedCaseId && (
                  <button
                    type="button"
                    onClick={() =>
                      void runCaseAnalysis(selectedCaseId)
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

            {selectedCaseResult && selectedCaseResult.evaluation_result_summary && (
              <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-[#808184]">
                Overview
              </h3>
            )}
            {selectedCaseResult && selectedCaseResult.evaluation_result_summary && (
              <div className="mt-3 flex flex-col gap-3 overflow-hidden rounded-2xl border border-[#e0e0e2] bg-white px-5 py-4">
                <div>
                  <span className="font-mono text-xs font-bold text-[#808184]">Policy Compliance: </span>
                  <span className="text-sm leading-relaxed text-[#414042]">{selectedCaseResult.evaluation_result_summary}</span>
                </div>
                {selectedCaseResult.evaluation_rule?.display && (
                  <div>
                    <span className="font-mono text-xs font-bold text-[#808184]">Policy Clause Requirements: </span>
                    <span className="text-sm leading-relaxed text-[#414042]">{selectedCaseResult.evaluation_rule.display}</span>
                  </div>
                )}
                {selectedCaseResult.evaluation_summary && (
                  <div>
                    <span className="font-mono text-xs font-bold text-[#808184]">AI Summary: </span>
                    <span className="text-sm leading-relaxed text-[#414042]">{selectedCaseResult.evaluation_summary}</span>
                  </div>
                )}
              </div>
            )}

            {selectedCaseResult && viewMode === "simple" && (!selectedCaseResult.evidence_review || selectedCaseResult.evidence_review.length === 0) && (
              <p className="mt-6 rounded-xl border border-[#e0e0e2] bg-[#f8f8f9] p-4 text-sm text-[#808184]">
                No evidence review data was returned for this case.
              </p>
            )}

            {selectedCaseResult && viewMode === "simple" && selectedCaseResult.evidence_review && selectedCaseResult.evidence_review.length > 0 && (
              <div className="mt-6 flex flex-col gap-4">
                {selectedCaseResult.evidence_review.map((category) => (
                  <div
                    key={category.evidence_category}
                    className="overflow-hidden rounded-2xl border border-[#e0e0e2] bg-[#f8f8f9]"
                  >
                    <div className="flex items-center justify-between gap-4 border-b border-[#e0e0e2] bg-white px-5 py-4">
                      <h3 className="text-sm font-semibold text-[#2e2d30]">
                        {formatConceptLabel(category.evidence_category)}
                      </h3>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#2e2d30] ${
                          category.status === "Sufficient"
                            ? "border-[#6dffb5] bg-[#ecfff5]"
                            : category.status === "Partially sufficient"
                              ? "border-[#ffd08a] bg-[#fff6e8]"
                              : "border-[#ffc6c6] bg-[#fff1f1]"
                        }`}
                      >
                        {category.status.charAt(0).toUpperCase() + category.status.slice(1)}
                      </span>
                    </div>
                    <div className="divide-y divide-[#e0e0e2]">
                      {category.clauses.map((clause) => (
                        <div
                          key={clause.clause_id}
                          className="flex items-start justify-between gap-4 px-5 py-3"
                        >
                          <p className="text-sm text-[#414042]">{clause.policy_text}</p>
                          <img
                            src={
                              clause.status === "satisfied"
                                ? checkIcon
                                : clause.status === "partial"
                                  ? cautionIcon
                                  : crossIcon
                            }
                            alt={clause.status}
                            className="ml-4 h-6 w-6 shrink-0"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedCaseResult && viewMode === "detailed" && (
              <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-[#808184]">
                Clause by Clause Breakdown
              </h3>
            )}
            {selectedCaseResult && viewMode === "detailed" && (() => {
              const allClauses = [
                ...(selectedCaseResult.approval_clauses ?? []),
                ...(selectedCaseResult.exclusion_clauses ?? []),
              ];
              const satisfiedClauses = allClauses.filter((c) => c.status !== "unsatisfied");
              const unsatisfiedClauses = allClauses.filter((c) => c.status === "unsatisfied");

              const renderClause = (clause: ClauseEvaluation) => {
                const hasMatches = clause.matched_concepts.length > 0;
                const isExpanded = expandedClauseIds[clause.clause_id] === true;
                return (
                  <div key={clause.clause_id}>
                    <div
                      onClick={hasMatches ? () => setExpandedClauseIds((cur) => ({ ...cur, [clause.clause_id]: !cur[clause.clause_id] })) : undefined}
                      className={`flex items-start gap-4 bg-white px-5 py-4 ${hasMatches ? "cursor-pointer hover:bg-[#f8f8f9]" : ""}`}
                    >
                      <span className="w-5 shrink-0 select-none text-center text-xl font-light leading-snug text-[#808184]">
                        {hasMatches ? (isExpanded ? "−" : "+") : ""}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-[#808184]">Policy Clause: </span>
                        <span className="text-sm text-[#414042]">{clause.policy_text}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className="inline-flex rounded-full border border-[#d1d1d4] bg-[#f4f4f5] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#808184]"
                        >
                          {clause.clause_type.charAt(0).toUpperCase() + clause.clause_type.slice(1)}
                        </span>
                        <img
                          src={
                            clause.status === "partial"
                              ? cautionIcon
                              : clause.clause_type === "exclusion"
                                ? clause.status === "satisfied"
                                  ? crossIcon
                                  : checkIcon
                                : clause.status === "satisfied"
                                  ? checkIcon
                                  : crossIcon
                          }
                          alt={clause.status}
                          className="h-6 w-6 shrink-0 mix-blend-multiply"
                        />
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-[#e0e0e2] bg-[#f8f8f9] px-5 py-4">
                        <div className="flex flex-col gap-2">
                          {clause.matched_concepts.map((match, i) => (
                            <div key={i} className="rounded-xl border border-[#e0e0e2] bg-white p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#808184]">
                                Certainty:{" "}
                                <span className="font-normal normal-case tracking-normal text-[#414042]">
                                  {match.certainty_level
                                    ? match.certainty_level.charAt(0).toUpperCase() + match.certainty_level.slice(1)
                                    : "—"}
                                </span>
                              </p>
                              <p className="mt-2 text-sm text-[#414042]">
                                <span className="font-mono text-xs text-[#808184]">Documented Evidence Text: </span>
                                {match.evidence_text}
                              </p>
                              {match.section && (
                                <p className="mt-1 text-sm text-[#414042]">
                                  <span className="font-mono text-xs text-[#808184]">Document Source: </span>
                                  {match.section}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <div className="mt-3 overflow-hidden rounded-2xl border border-[#e0e0e2]">
                  <div className="divide-y divide-[#e0e0e2]">
                    {satisfiedClauses.map(renderClause)}
                    {unsatisfiedClauses.length > 0 && (
                      <>
                        <div
                          onClick={() => setUnsatisfiedClausesExpanded((v) => !v)}
                          className="flex cursor-pointer items-center gap-4 bg-[#f8f8f9] px-5 py-4 hover:bg-[#f0f0f1]"
                        >
                          <span className="w-5 shrink-0 select-none text-center text-xl font-light leading-snug text-[#808184]">
                            {unsatisfiedClausesExpanded ? "−" : "+"}
                          </span>
                          <span className="text-sm font-semibold text-[#808184]">
                            {unsatisfiedClausesExpanded
                              ? `Hide ${unsatisfiedClauses.length} unsatisfied clause${unsatisfiedClauses.length === 1 ? "" : "s"}`
                              : `+ ${unsatisfiedClauses.length} more unsatisfied clause${unsatisfiedClauses.length === 1 ? "" : "s"}`}
                          </span>
                        </div>
                        {unsatisfiedClausesExpanded && unsatisfiedClauses.map(renderClause)}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {isCreateCaseModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2e2d30]/50 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-[28px] border border-[#d7d8da] bg-white p-6 shadow-[0_24px_60px_rgba(46,45,48,0.24)] sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[#808184]">
                    New case details
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#2e2d30]">
                    Enter case parameters
                  </h2>
                  <p className="mt-2 text-sm text-[#808184]">
                    Complete these fields before selecting documents to upload.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateCaseModal}
                  disabled={createCaseLoading || paCheckLoading}
                  className="rounded-full border border-[#d7d8da] px-3 py-1 text-sm font-medium text-[#414042] transition hover:border-[#6dffb5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>

              <form className="mt-6 space-y-5" onSubmit={handleCreateCaseDetailsSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#2e2d30]">
                    Name
                  </span>
                  <input
                    type="text"
                    value={createCaseForm.patientName}
                    onChange={(event) =>
                      handleCreateCaseFieldChange("patientName", event.currentTarget.value)
                    }
                    className="w-full rounded-2xl border border-[#d7d8da] bg-[#f8f8f9] px-4 py-3 text-sm text-[#414042] outline-none transition focus:border-[#00ff7d] focus:bg-white"
                    placeholder="Unknown"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#2e2d30]">
                    Payer
                  </span>
                  <select
                    value={createCaseForm.payer}
                    onChange={(event) =>
                      handleCreateCaseFieldChange(
                        "payer",
                        event.currentTarget.value as CreateCaseFormValues["payer"],
                      )
                    }
                    className="w-full rounded-2xl border border-[#d7d8da] bg-[#f8f8f9] px-4 py-3 text-sm text-[#414042] outline-none transition focus:border-[#00ff7d] focus:bg-white"
                  >
                    <option value="">Select a payer</option>
                    <option value="Aetna">Aetna</option>
                    <option value="Humana">Humana</option>
                  </select>
                  {createCaseFormErrors.payer && (
                    <p className="mt-2 text-sm text-[#9b2c2c]">
                      {createCaseFormErrors.payer}
                    </p>
                  )}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#2e2d30]">
                    CPT Code
                  </span>
                  <input
                    type="text"
                    value={createCaseForm.cptCode}
                    onChange={(event) =>
                      handleCreateCaseFieldChange("cptCode", event.currentTarget.value)
                    }
                    className="w-full rounded-2xl border border-[#d7d8da] bg-[#f8f8f9] px-4 py-3 text-sm text-[#414042] outline-none transition focus:border-[#00ff7d] focus:bg-white"
                    placeholder="72148"
                  />
                  {createCaseFormErrors.cptCode && (
                    <p className="mt-2 text-sm text-[#9b2c2c]">
                      {createCaseFormErrors.cptCode}
                    </p>
                  )}
                </label>

                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeCreateCaseModal}
                    disabled={createCaseLoading || paCheckLoading}
                    className="rounded-full border border-[#d7d8da] bg-white px-5 py-2.5 text-sm font-semibold text-[#414042] transition hover:border-[#6dffb5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createCaseLoading || paCheckLoading}
                    className="rounded-full bg-[#00ff7d] px-5 py-2.5 text-sm font-semibold text-[#414042] transition hover:bg-[#6dffb5] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {paCheckLoading ? "Checking..." : "Continue to documents"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {paNotRequiredResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2e2d30]/50 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-[#d7d8da] bg-white p-6 shadow-[0_24px_60px_rgba(46,45,48,0.24)] sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[#808184]">
                  PA check result
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[#2e2d30]">
                  Prior authorization not required
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPaNotRequiredResult(null)}
                className="rounded-full border border-[#d7d8da] px-3 py-1 text-sm font-medium text-[#414042] transition hover:border-[#6dffb5]"
              >
                Close
              </button>
            </div>
            <p className="mt-4 text-sm text-[#414042]">
              Prior authorization not required for{" "}
              <span className="font-semibold">{paNotRequiredResult.cpt_code}</span>{" "}
              under{" "}
              <span className="font-semibold">{paNotRequiredResult.payer}</span>:{" "}
              {paNotRequiredResult.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
