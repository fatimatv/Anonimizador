'use client';

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  Files,
  FileText,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Users,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  approveDocument,
  currentSession,
  deleteJob,
  downloadAnonymized,
  getAnonymizedPreview,
  getDetections,
  getJob,
  login,
  logout,
  publicLogin,
  rejectDocument,
  renderAnonymizedText,
  updateAnonymizedPreview,
  uploadBatch,
  type AnonymizedOutputFormat,
  type CurrentUser,
  type DetectionItem,
  type DocumentItem,
  type JobDetail,
} from '../lib/api';

const statusLabels: Record<string, string> = {
  anonymizing: 'Anonimizando',
  approved: 'Aprobado',
  completed: 'Completado',
  deleted: 'Eliminado',
  detecting_entities: 'Detectando',
  extracting_text: 'Extrayendo',
  failed: 'Fallido',
  needs_review: 'Revisión',
  processing: 'Procesando',
  queued: 'En cola',
  rejected: 'Rechazado',
  uploaded: 'Cargado',
};

type UploadMode = 'batch' | 'single';
type MainTab = 'methodology' | 'workspace';

export default function HomePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFilesByDocumentId, setUploadedFilesByDocumentId] = useState<Record<string, File>>(
    {},
  );
  const [uploadMode, setUploadMode] = useState<UploadMode>('single');
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionItem[]>([]);
  const [anonymizedPreview, setAnonymizedPreview] = useState<string | null>(null);
  const [editedPreview, setEditedPreview] = useState('');
  const [downloadFormat, setDownloadFormat] = useState<AnonymizedOutputFormat>('txt');
  const [activeTab, setActiveTab] = useState<MainTab>('workspace');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedDocument = useMemo(() => {
    return jobDetail?.documents.find((document) => document.id === selectedDocumentId) ?? null;
  }, [jobDetail, selectedDocumentId]);
  const canUpload = user?.role === 'admin' || user?.role === 'operator';
  const canReview =
    user?.role === 'admin' || user?.role === 'reviewer' || user?.role === 'operator';

  const showError = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      setNotice(error.code);
      return;
    }

    setNotice('No se pudo completar la operación');
  }, []);

  const refreshJob = useCallback(async () => {
    if (!jobDetail?.job.id) {
      return;
    }

    try {
      setJobDetail(await getJob(jobDetail.job.id));
    } catch (error) {
      showError(error);
    }
  }, [jobDetail?.job.id, showError]);

  useEffect(() => {
    currentSession()
      .then((session) => setUser(session.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) {
      setDetections([]);
      setAnonymizedPreview(null);
      setEditedPreview('');
      return;
    }

    if (selectedDocument?.detections) {
      setDetections(selectedDocument.detections);
      return;
    }

    getDetections(selectedDocumentId)
      .then((result) => setDetections(result.detections))
      .catch((error) => showError(error));
  }, [selectedDocument, selectedDocumentId, showError]);

  useEffect(() => {
    if (!selectedDocumentId || !canReview || selectedDocument?.status !== 'needs_review') {
      if (selectedDocument?.anonymizedPreview) {
        setAnonymizedPreview(selectedDocument.anonymizedPreview);
        setEditedPreview(selectedDocument.anonymizedPreview);
        return;
      }

      setAnonymizedPreview(null);
      return;
    }

    if (selectedDocument.anonymizedPreview) {
      setAnonymizedPreview(selectedDocument.anonymizedPreview);
      setEditedPreview(selectedDocument.anonymizedPreview);
      return;
    }

    getAnonymizedPreview(selectedDocumentId)
      .then((result) => {
        setAnonymizedPreview(result.text);
        setEditedPreview(result.text);
      })
      .catch((error) => showError(error));
  }, [
    canReview,
    selectedDocument?.anonymizedPreview,
    selectedDocument?.status,
    selectedDocumentId,
    showError,
  ]);

  useEffect(() => {
    if (uploadMode === 'single' && files.length > 1) {
      setFiles(files.slice(0, 1));
    }
  }, [files, uploadMode]);

  useEffect(() => {
    if (!selectedDocument) {
      return;
    }

    if (selectedDocument.mimeType === 'application/pdf') {
      setDownloadFormat('pdf');
      return;
    }

    if (
      selectedDocument.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      setDownloadFormat('docx');
      return;
    }

    setDownloadFormat('txt');
  }, [selectedDocument?.id, selectedDocument?.mimeType]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);

    try {
      const result = await login({ email, password });
      setUser(result.user);
      setPassword('');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handlePublicAccess() {
    setBusy(true);
    setNotice(null);

    try {
      const result = await publicLogin();

      setUser(result.user);
      setPassword('');
      setEmail('');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);

    try {
      await logout();
      setUser(null);
      setJobDetail(null);
      setSelectedDocumentId(null);
      setDetections([]);
      setAnonymizedPreview(null);
      setEditedPreview('');
      setUploadedFilesByDocumentId({});
      setActiveTab('workspace');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (files.length === 0) {
      setNotice('Selecciona al menos un documento');
      return;
    }

    setBusy(true);
    setNotice(null);

    try {
      const upload = await uploadBatch(files);
      const uploadedFiles = files;

      setJobDetail(upload);
      setSelectedDocumentId(upload.documents[0]?.id ?? null);
      setUploadedFilesByDocumentId(
        Object.fromEntries(
          upload.documents
            .map((document, index) => [document.id, uploadedFiles[index]] as const)
            .filter((entry): entry is readonly [string, File] => entry[1] instanceof File),
        ),
      );
      setFiles([]);
      setNotice(upload.documents.length === 1 ? 'Documento procesado' : 'Lote procesado');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(documentId: string, action: 'approve' | 'reject') {
    setBusy(true);
    setNotice(null);

    try {
      const document = jobDetail?.documents.find((candidate) => candidate.id === documentId);

      if (document?.anonymizedPreview && user?.role === 'operator') {
        const nextStatus = action === 'approve' ? 'approved' : 'rejected';
        const nextPreview =
          documentId === selectedDocumentId && editedPreview.trim().length > 0
            ? editedPreview
            : document.anonymizedPreview;

        setJobDetail((current) =>
          current ? updateDocumentLocally(current, documentId, nextStatus, nextPreview) : current,
        );
        setAnonymizedPreview(nextPreview);
        setEditedPreview(nextPreview);
        return;
      }

      if (action === 'approve') {
        await approveDocument(documentId);
      } else {
        await rejectDocument(documentId);
      }

      await refreshJob();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePreview() {
    if (!selectedDocumentId) {
      return;
    }

    setBusy(true);
    setNotice(null);

    try {
      const document = jobDetail?.documents.find(
        (candidate) => candidate.id === selectedDocumentId,
      );

      if (document?.anonymizedPreview && user?.role === 'operator') {
        setAnonymizedPreview(editedPreview);
        setJobDetail((current) =>
          current
            ? {
                ...current,
                documents: current.documents.map((candidate) =>
                  candidate.id === selectedDocumentId
                    ? { ...candidate, anonymizedPreview: editedPreview }
                    : candidate,
                ),
                job: {
                  ...current.job,
                },
              }
            : current,
        );
        setNotice('Vista anonimizada actualizada');
        return;
      }

      const result = await updateAnonymizedPreview({
        documentId: selectedDocumentId,
        text: editedPreview,
      });

      setAnonymizedPreview(result.text);
      setEditedPreview(result.text);
      setNotice('Vista anonimizada actualizada');
      await refreshJob();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(documentId: string) {
    setBusy(true);
    setNotice(null);

    try {
      const document = jobDetail?.documents.find((candidate) => candidate.id === documentId);
      const originalPdf =
        document &&
        downloadFormat === 'pdf' &&
        document.mimeType === 'application/pdf' &&
        uploadedFilesByDocumentId[documentId]
          ? uploadedFilesByDocumentId[documentId]
          : null;
      const redactions = document?.detections?.map((detection) => ({
        endOffset: detection.endOffset,
        startOffset: detection.startOffset,
      }));
      const blob = document?.anonymizedPreview
        ? await renderAnonymizedText({
            format: downloadFormat,
            ...(originalPdf ? { originalPdf } : {}),
            ...(redactions ? { redactions } : {}),
            text: document.anonymizedPreview,
          })
        : await downloadAnonymized(documentId, downloadFormat);

      downloadBlob(blob, `anonimizado-${shortDocumentId(documentId)}.${downloadFormat}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteJob() {
    if (!jobDetail) {
      return;
    }

    setBusy(true);
    setNotice(null);

    try {
      await deleteJob(jobDetail.job.id);
      setJobDetail(null);
      setSelectedDocumentId(null);
      setDetections([]);
      setAnonymizedPreview(null);
      setEditedPreview('');
      setUploadedFilesByDocumentId({});
      setNotice('Job eliminado');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-[#111827] sm:px-6">
        <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl content-center gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="ialaw-login-panel flex flex-col justify-between rounded-lg p-8 shadow-sm">
            <div className="space-y-8">
              <div>
                <BrandMark inverted />
                <div className="ialaw-accent-bar mt-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FBBB02]">
                  Digital Lawyers
                </p>
                <h1 className="mt-4 max-w-2xl text-4xl font-black uppercase leading-tight sm:text-5xl">
                  Anonimizador documental
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-white/78">
                  Consola privada para cargar lotes, revisar detecciones, aprobar resultados y
                  descargar documentos anonimizados con motor local.
                </p>
              </div>
            </div>
            <div className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
              <Metric label="Motor" value="Local" />
              <Metric label="IA externa" value="No" />
              <Metric label="Revisión" value="Obligatoria" />
            </div>
          </div>

          <form onSubmit={handleLogin} className="ialaw-card ialaw-card--accent p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <BrandMark />
                <h2 className="mt-5 text-lg font-extrabold text-[#011EF4]">Ingreso seguro</h2>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#011EF4] text-white">
                <ShieldCheck size={22} aria-hidden="true" />
              </div>
            </div>
            <label className="mt-5 block text-sm font-semibold text-[#636466]">
              Correo
              <input
                className="ialaw-input mt-2"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="mt-4 block text-sm font-semibold text-[#636466]">
              Contraseña
              <input
                className="ialaw-input mt-2"
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {notice ? <Notice message={notice} /> : null}
            <button className="ialaw-button-primary mt-5 w-full" disabled={busy} type="submit">
              <ShieldCheck size={18} aria-hidden="true" />
              Entrar
            </button>
            <button
              className="ialaw-button-primary ialaw-button-yellow mt-3 w-full"
              disabled={busy}
              onClick={handlePublicAccess}
              type="button"
            >
              <Users size={18} aria-hidden="true" />
              Usar sin cuenta
            </button>
            <p className="mt-5 border-t border-[#dfe3ef] pt-4 text-center text-xs leading-5 text-[#6F7072]">
              Uso publico temporal para resguardar privacidad documental, con acceso privado para{' '}
              <span className="font-extrabold text-[#011EF4]">IALAW Digital Lawyers</span>.
            </p>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-[#111827]">
      <header className="border-b border-[#dfe3ef] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#011EF4] text-sm font-black text-white">
              IA
            </div>
            <div>
              <BrandMark />
              <h1 className="mt-1 text-xl font-extrabold text-[#011EF4]">
                Anonimizador documental
              </h1>
              <p className="text-sm text-[#6F7072]">
                {userLabel(user)} · {roleLabel(user)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              aria-pressed={activeTab === 'workspace'}
              className={activeTab === 'workspace' ? 'icon-button is-active' : 'icon-button'}
              onClick={() => setActiveTab('workspace')}
              title="Procesar documentos"
              type="button"
            >
              <UploadCloud size={17} aria-hidden="true" />
              Procesar
            </button>
            <button
              aria-pressed={activeTab === 'methodology'}
              className={activeTab === 'methodology' ? 'icon-button is-active' : 'icon-button'}
              onClick={() => setActiveTab('methodology')}
              title="Metodología de privacidad"
              type="button"
            >
              <BookOpen size={17} aria-hidden="true" />
              Metodología
            </button>
            <button
              className="icon-button"
              onClick={refreshJob}
              disabled={busy || !jobDetail}
              title="Actualizar"
              type="button"
            >
              <RefreshCw size={17} aria-hidden="true" />
              Actualizar
            </button>
            <button
              className="icon-button"
              onClick={handleLogout}
              disabled={busy}
              title="Salir"
              type="button"
            >
              <LogOut size={17} aria-hidden="true" />
              Salir
            </button>
          </div>
        </div>
      </header>

      {activeTab === 'methodology' ? (
        <MethodologyView />
      ) : (
        <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-5">
            <section className="ialaw-card ialaw-card--accent p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-extrabold text-[#011EF4]">Carga</h2>
                <UploadCloud className="text-[#011EF4]" size={20} aria-hidden="true" />
              </div>
              <form onSubmit={handleUpload} className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    aria-pressed={uploadMode === 'single'}
                    className={
                      uploadMode === 'single'
                        ? 'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#011EF4] px-3 text-sm font-bold text-white'
                        : 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#dfe3ef] bg-white px-3 text-sm font-bold text-[#374151]'
                    }
                    disabled={busy}
                    onClick={() => setUploadMode('single')}
                    type="button"
                  >
                    <FileText size={16} aria-hidden="true" />
                    Documento
                  </button>
                  <button
                    aria-pressed={uploadMode === 'batch'}
                    className={
                      uploadMode === 'batch'
                        ? 'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#011EF4] px-3 text-sm font-bold text-white'
                        : 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#dfe3ef] bg-white px-3 text-sm font-bold text-[#374151]'
                    }
                    disabled={busy}
                    onClick={() => setUploadMode('batch')}
                    type="button"
                  >
                    <Files size={16} aria-hidden="true" />
                    Lote
                  </button>
                </div>
                <input
                  key={uploadMode}
                  className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-[#011EF4] file:px-3 file:text-sm file:font-bold file:text-white"
                  disabled={!canUpload || busy}
                  multiple={uploadMode === 'batch'}
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);

                    setFiles(uploadMode === 'single' ? selectedFiles.slice(0, 1) : selectedFiles);
                  }}
                  type="file"
                  accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                />
                <div className="min-h-10 rounded-md bg-[#f4f6fb] px-3 py-2 text-sm text-[#6F7072]">
                  {files.length > 0
                    ? files.length === 1
                      ? '1 documento seleccionado'
                      : `${files.length} documentos seleccionados`
                    : 'Sin documentos'}
                </div>
                <button
                  className="ialaw-button-primary w-full"
                  disabled={!canUpload || busy}
                  type="submit"
                >
                  <UploadCloud size={17} aria-hidden="true" />
                  {uploadMode === 'single' ? 'Procesar documento' : 'Procesar lote'}
                </button>
              </form>
            </section>

            <section className="ialaw-card p-5">
              <h2 className="text-base font-extrabold text-[#011EF4]">Job</h2>
              {jobDetail ? (
                <>
                  <div className="mt-4 grid gap-3 text-sm">
                    <Metric label="Estado" value={labelForStatus(jobDetail.job.status)} />
                    <Metric label="Archivos" value={String(jobDetail.job.totalFiles)} />
                    <Metric label="Riesgo" value={jobDetail.job.riskLevel ?? 'low'} />
                  </div>
                  <button
                    className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-950 disabled:opacity-50"
                    disabled={busy || user.role === 'reviewer'}
                    onClick={handleDeleteJob}
                    title="Eliminar job"
                    type="button"
                  >
                    <Trash2 size={17} aria-hidden="true" />
                    Eliminar job
                  </button>
                </>
              ) : (
                <p className="mt-4 text-sm text-[#6F7072]">No hay lote activo.</p>
              )}
            </section>

            {notice ? <Notice message={notice} /> : null}
          </aside>

          <section className="ialaw-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#dfe3ef] px-5 py-4">
              <h2 className="text-base font-extrabold text-[#011EF4]">Documentos</h2>
              <FileText className="text-[#011EF4]" size={20} aria-hidden="true" />
            </div>
            {jobDetail ? (
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0">
                  <div className="divide-y divide-[#dfe3ef]">
                    {jobDetail.documents.map((document) => (
                      <DocumentRow
                        canReview={canReview}
                        document={document}
                        isSelected={document.id === selectedDocumentId}
                        key={document.id}
                        onApprove={() => handleReview(document.id, 'approve')}
                        onDownload={() => handleDownload(document.id)}
                        onReject={() => handleReview(document.id, 'reject')}
                        onSelect={() => setSelectedDocumentId(document.id)}
                        busy={busy}
                      />
                    ))}
                  </div>
                  <ReviewPanel
                    anonymizedPreview={anonymizedPreview}
                    busy={busy}
                    canReview={canReview}
                    document={selectedDocument}
                    downloadFormat={downloadFormat}
                    editedPreview={editedPreview}
                    onDownloadFormatChange={setDownloadFormat}
                    onEditedPreviewChange={setEditedPreview}
                    onSavePreview={handleSavePreview}
                  />
                </div>
                <DetectionPanel document={selectedDocument} detections={detections} />
              </div>
            ) : (
              <div className="p-8 text-sm text-[#6F7072]">
                Carga un documento o un lote para ver resultados.
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function DocumentRow(props: {
  busy: boolean;
  canReview: boolean;
  document: DocumentItem;
  isSelected: boolean;
  onApprove: () => void;
  onDownload: () => void;
  onReject: () => void;
  onSelect: () => void;
}) {
  const { document } = props;
  const totalEntities = document.detectionSummary?.totalEntities ?? 0;
  const replacements = document.validationSummary?.anonymization?.replacementsApplied ?? 0;

  return (
    <article className={props.isSelected ? 'bg-[#011EF4]/[0.04] p-5' : 'bg-white p-5'}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-[#011EF4] px-2 py-1 text-xs font-extrabold text-white">
              {labelForStatus(document.status)}
            </span>
            <span className="rounded-md bg-[#FBBB02] px-2 py-1 text-xs font-extrabold text-[#111827]">
              {document.detectionSummary?.riskLevel ?? 'low'}
            </span>
          </div>
          <p className="mt-3 truncate font-mono text-xs text-[#6F7072]">{document.id}</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <DocumentStat label="Tamaño" value={formatBytes(document.fileSizeBytes)} />
            <DocumentStat label="Detecciones" value={String(totalEntities)} />
            <DocumentStat label="Reemplazos" value={String(replacements)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            aria-pressed={props.isSelected}
            className={
              props.isSelected
                ? 'icon-button border-[#011EF4] bg-[#011EF4] text-white'
                : 'icon-button'
            }
            onClick={props.onSelect}
            title="Ver detecciones"
            type="button"
          >
            <Eye size={17} aria-hidden="true" />
            Ver
          </button>
          <button
            className="icon-button"
            disabled={!props.canReview || props.busy || document.status !== 'needs_review'}
            onClick={props.onApprove}
            title="Aprobar"
            type="button"
          >
            <CheckCircle2 size={17} aria-hidden="true" />
            Aprobar
          </button>
          <button
            className="icon-button"
            disabled={!props.canReview || props.busy || document.status !== 'needs_review'}
            onClick={props.onReject}
            title="Rechazar"
            type="button"
          >
            <XCircle size={17} aria-hidden="true" />
            Rechazar
          </button>
          <button
            className="icon-button"
            disabled={props.busy || document.status !== 'approved'}
            onClick={props.onDownload}
            title="Descargar"
            type="button"
          >
            <Download size={17} aria-hidden="true" />
            Descargar
          </button>
        </div>
      </div>
    </article>
  );
}

function DocumentStat(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[#dfe3ef] bg-white px-3 py-2">
      <p className="text-[0.68rem] font-extrabold uppercase text-[#6F7072]">{props.label}</p>
      <p className="mt-1 truncate text-sm font-extrabold text-[#111827]">{props.value}</p>
    </div>
  );
}

function ReviewPanel(props: {
  anonymizedPreview: string | null;
  busy: boolean;
  canReview: boolean;
  document: DocumentItem | null;
  downloadFormat: AnonymizedOutputFormat;
  editedPreview: string;
  onDownloadFormatChange: (format: AnonymizedOutputFormat) => void;
  onEditedPreviewChange: (text: string) => void;
  onSavePreview: () => void;
}) {
  const document = props.document;
  const totalEntities = document?.detectionSummary?.totalEntities ?? 0;
  const replacements = document?.validationSummary?.anonymization?.replacementsApplied ?? 0;

  return (
    <section className="border-t border-[#dfe3ef] bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-extrabold text-[#011EF4]">Vista de revisión</h3>
          {document ? (
            <p className="mt-1 font-mono text-xs text-[#6F7072]">
              {shortDocumentId(document.id)} · {labelForStatus(document.status)}
            </p>
          ) : null}
        </div>
        {document ? (
          <div className="grid gap-2 text-sm sm:grid-cols-[1fr_1fr_auto]">
            <Metric label="Detecciones" value={String(totalEntities)} />
            <Metric label="Reemplazos" value={String(replacements)} />
            <label className="min-w-[120px] text-xs font-extrabold uppercase text-[#6F7072]">
              Formato
              <select
                className="ialaw-input mt-1 h-9 py-1 text-sm normal-case"
                value={props.downloadFormat}
                onChange={(event) =>
                  props.onDownloadFormatChange(event.target.value as AnonymizedOutputFormat)
                }
              >
                <option value="txt">TXT</option>
                <option value="docx">DOCX</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      <div className="mt-4 min-h-[360px] max-h-[560px] overflow-auto rounded-md border border-[#dfe3ef] bg-[#f8fafc]">
        {document && props.canReview && document.status === 'needs_review' ? (
          <textarea
            className="min-h-[360px] w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-[#111827] outline-none"
            value={props.editedPreview}
            onChange={(event) => props.onEditedPreviewChange(event.target.value)}
            spellCheck={false}
          />
        ) : document ? (
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-[#111827]">
            {props.anonymizedPreview || 'Documento sin texto anonimizado disponible.'}
          </pre>
        ) : (
          <p className="p-4 text-sm text-[#6F7072]">Selecciona un documento.</p>
        )}
      </div>
      {document && props.canReview && document.status === 'needs_review' ? (
        <button
          className="icon-button mt-3"
          disabled={props.busy || props.editedPreview.trim().length === 0}
          onClick={props.onSavePreview}
          title="Guardar corrección"
          type="button"
        >
          <Save size={17} aria-hidden="true" />
          Guardar corrección
        </button>
      ) : null}
    </section>
  );
}

function DetectionPanel(props: { detections: DetectionItem[]; document: DocumentItem | null }) {
  return (
    <aside className="border-t border-[#dfe3ef] bg-[#f4f6fb] p-5 lg:border-l lg:border-t-0">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-[#011EF4]">Detecciones</h3>
      {props.document ? (
        <div className="mt-4 space-y-3">
          {props.detections.length > 0 ? (
            props.detections.map((detection) => (
              <div
                className="rounded-lg border border-[#dfe3ef] bg-white p-3 text-sm"
                key={detection.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-[#111827]">{detection.entityType}</span>
                  <span className="text-xs text-[#6F7072]">
                    {Math.round(detection.confidence * 100)}%
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs text-[#374151]">{detection.previewMasked}</p>
                <p className="mt-2 border-l-4 border-[#FBBB02] pl-2 text-xs text-[#6F7072]">
                  {detection.replacementType}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#6F7072]">Sin detecciones.</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[#6F7072]">Selecciona un documento.</p>
      )}
    </aside>
  );
}

function MethodologyView() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <section className="ialaw-card ialaw-card--accent overflow-hidden">
        <div className="border-b border-[#dfe3ef] px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-[#011EF4]">Metodología de privacidad</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6F7072]">
                La plataforma minimiza exposición de datos: procesa documentos con reglas locales,
                evita IA externa y no usa base de datos persistente para almacenar documentos
                cargados.
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#011EF4] text-white">
              <LockKeyhole size={22} aria-hidden="true" />
            </div>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-3">
          <MethodologyCard
            icon={<UploadCloud size={20} aria-hidden="true" />}
            title="Procesamiento temporal"
            body="El archivo se envía al backend sólo para extraer texto, detectar patrones sensibles y devolver el resultado anonimizado. En el despliegue actual no se guardan documentos en una base de datos."
          />
          <MethodologyCard
            icon={<ShieldCheck size={20} aria-hidden="true" />}
            title="Motor local"
            body="La detección usa reglas determinísticas para DNI, RUC, correos, teléfonos, tarjetas, direcciones, nombres contextuales y otros patrones. No se llama a APIs de IA externas."
          />
          <MethodologyCard
            icon={<Eye size={20} aria-hidden="true" />}
            title="Revisión obligatoria"
            body="El usuario revisa el texto anonimizado y las detecciones antes de aprobar la descarga. La aprobación ocurre en la sesión actual para evitar persistir documentos."
          />
        </div>

        <div className="grid gap-5 border-t border-[#dfe3ef] bg-[#f8fafc] p-5 lg:grid-cols-[1fr_1fr]">
          <section>
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-[#011EF4]">
              Qué no se almacena
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[#374151]">
              <li>No se registra el nombre original del archivo; se trabaja con hashes.</li>
              <li>
                No se guardan valores crudos detectados; se guardan hashes y vistas enmascaradas.
              </li>
              <li>No se conserva una base histórica de documentos cargados en producción.</li>
            </ul>
          </section>
          <section>
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-[#011EF4]">
              Alcance real
            </h3>
            <p className="mt-3 text-sm leading-6 text-[#374151]">
              El procesamiento usa almacenamiento temporal del runtime serverless y memoria de la
              sesión para completar la operación. Ese entorno puede existir brevemente mientras la
              función está activa, pero no se implementó persistencia documental permanente. Para
              auditoría empresarial con usuarios nominales se recomienda una fase separada con
              Supabase y políticas explícitas de retención.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}

function MethodologyCard(props: { body: string; icon: ReactNode; title: string }) {
  return (
    <article className="border-b border-[#dfe3ef] p-5 lg:border-b-0 lg:border-r last:lg:border-r-0">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#011EF4]/10 text-[#011EF4]">
        {props.icon}
      </div>
      <h3 className="mt-4 text-base font-extrabold text-[#111827]">{props.title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#6F7072]">{props.body}</p>
    </article>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="ialaw-metric">
      <p className="ialaw-metric__label">{props.label}</p>
      <p className="ialaw-metric__value">{props.value}</p>
    </div>
  );
}

function Notice(props: { message: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#FBBB02]/50 bg-[#fff8df] p-3 text-sm text-[#111827]">
      <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
      <span>{messageForNotice(props.message)}</span>
    </div>
  );
}

function BrandMark(props: { inverted?: boolean }) {
  return (
    <div className="ialaw-wordmark" data-inverted={props.inverted ? 'true' : 'false'}>
      <span>IALAW</span>
      <span className="ialaw-wordmark__accent">Digital Lawyers</span>
    </div>
  );
}

function roleLabel(user: CurrentUser): string {
  if (user.id === 'public-access-operator') {
    return 'Uso publico';
  }

  const labels: Record<string, string> = {
    admin: 'Admin',
    operator: 'Operador',
    reviewer: 'Revisor',
  };

  return labels[user.role] ?? user.role;
}

function userLabel(user: CurrentUser): string {
  return user.id === 'public-access-operator' ? 'Sesion publica temporal' : user.email;
}

function updateDocumentLocally(
  current: JobDetail,
  documentId: string,
  nextStatus: string,
  anonymizedPreview: string,
): JobDetail {
  const documents = current.documents.map((candidate) =>
    candidate.id === documentId
      ? { ...candidate, anonymizedPreview, status: nextStatus }
      : candidate,
  );

  return {
    documents,
    job: {
      ...current.job,
      status: summarizeJobStatus(documents),
    },
  };
}

function summarizeJobStatus(documents: DocumentItem[]): string {
  if (documents.some((document) => document.status === 'needs_review')) {
    return 'needs_review';
  }

  if (documents.some((document) => document.status === 'failed')) {
    return 'failed';
  }

  if (documents.length > 0 && documents.every((document) => document.status === 'approved')) {
    return 'approved';
  }

  if (documents.length > 0 && documents.every((document) => document.status === 'rejected')) {
    return 'rejected';
  }

  return 'completed';
}

function labelForStatus(status: string): string {
  return statusLabels[status] ?? status;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function messageForNotice(message: string): string {
  const messages: Record<string, string> = {
    anonymized_file_not_ready: 'El documento anonimizado aun no esta listo.',
    authentication_required: 'Tu sesion expiro. Vuelve a ingresar.',
    document_not_approved: 'Aprueba el documento antes de descargarlo.',
    document_not_found: 'No se encontro el documento.',
    document_not_ready_for_review: 'El documento aun no esta listo para revision.',
    empty_batch: 'Selecciona al menos un documento.',
    empty_file: 'El archivo esta vacio.',
    file_too_large: 'El archivo supera el tamano permitido.',
    insufficient_role: 'Tu usuario no tiene permisos para esta accion.',
    invalid_credentials: 'Correo o contrasena incorrectos.',
    invalid_origin: 'La solicitud fue bloqueada por origen no permitido.',
    invalid_payload: 'Revisa los datos ingresados.',
    job_not_found: 'No se encontro la carga.',
    login_temporarily_blocked: 'Ingreso bloqueado temporalmente por intentos fallidos.',
    mime_mismatch: 'El contenido no coincide con el tipo de archivo.',
    public_access_unavailable: 'El acceso publico esta temporalmente no disponible.',
    request_failed: 'No se pudo completar la solicitud.',
    too_many_files: 'El lote supera la cantidad maxima permitida.',
    unsafe_file_name: 'El nombre del archivo no es seguro.',
    unsupported_extension: 'Formato no soportado. Usa TXT, PDF o DOCX.',
  };

  return messages[message] ?? message;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function shortDocumentId(documentId: string): string {
  return documentId.slice(0, 8);
}
