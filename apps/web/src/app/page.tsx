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
  getDetections,
  getJob,
  login,
  logout,
  publicLogin,
  rejectDocument,
  uploadBatch,
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
  const [uploadMode, setUploadMode] = useState<UploadMode>('single');
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionItem[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>('workspace');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedDocument = useMemo(() => {
    return jobDetail?.documents.find((document) => document.id === selectedDocumentId) ?? null;
  }, [jobDetail, selectedDocumentId]);
  const isLocalJob = useMemo(() => {
    return jobDetail?.documents.some((document) => document.anonymizedText !== undefined) ?? false;
  }, [jobDetail]);

  const canUpload = user?.role === 'admin' || user?.role === 'operator';
  const canReview =
    user?.role === 'admin' ||
    user?.role === 'reviewer' ||
    (isLocalJob && user?.role === 'operator');

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

    if (isLocalJob) {
      setNotice('Los resultados de esta carga ya estan actualizados');
      return;
    }

    try {
      setJobDetail(await getJob(jobDetail.job.id));
    } catch (error) {
      showError(error);
    }
  }, [isLocalJob, jobDetail?.job.id, showError]);

  useEffect(() => {
    currentSession()
      .then((session) => setUser(session.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) {
      setDetections([]);
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
    if (uploadMode === 'single' && files.length > 1) {
      setFiles(files.slice(0, 1));
    }
  }, [files, uploadMode]);

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
      setJobDetail(upload);
      setSelectedDocumentId(upload.documents[0]?.id ?? null);
      setFiles([]);
      setNotice(upload.documents.length === 1 ? 'Documento procesado' : 'Lote procesado');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function updateLocalDocumentStatus(documentId: string, status: 'approved' | 'rejected') {
    setJobDetail((currentDetail) => {
      if (!currentDetail) {
        return currentDetail;
      }

      const documents = currentDetail.documents.map((document) => {
        return document.id === documentId ? { ...document, status } : document;
      });
      const reviewedDocuments = documents.filter((document) => {
        return document.status === 'approved' || document.status === 'rejected';
      });

      return {
        documents,
        job: {
          ...currentDetail.job,
          status:
            reviewedDocuments.length === documents.length ? 'completed' : currentDetail.job.status,
        },
      };
    });
    setNotice(status === 'approved' ? 'Documento aprobado' : 'Documento rechazado');
  }

  async function handleReview(documentId: string, action: 'approve' | 'reject') {
    setBusy(true);
    setNotice(null);

    try {
      if (isLocalJob) {
        updateLocalDocumentStatus(documentId, action === 'approve' ? 'approved' : 'rejected');
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

  async function handleDownload(documentId: string) {
    setBusy(true);
    setNotice(null);

    try {
      const localDocument = jobDetail?.documents.find((document) => document.id === documentId);

      if (localDocument?.anonymizedText !== undefined) {
        downloadLocalAnonymizedDocument(localDocument, localDocument.anonymizedText ?? '');
        return;
      }

      const blob = await downloadAnonymized(documentId);
      const extension = outputExtensionFor(localDocument);

      downloadBlob(blob, `anonimizado-${shortDocumentId(documentId)}${extension}`);
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
      if (isLocalJob) {
        setJobDetail(null);
        setSelectedDocumentId(null);
        setDetections([]);
        setNotice('Carga eliminada');
        return;
      }

      await deleteJob(jobDetail.job.id);
      setJobDetail(null);
      setSelectedDocumentId(null);
      setDetections([]);
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
                  <ReviewPanel document={selectedDocument} />
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

function ReviewPanel(props: { document: DocumentItem | null }) {
  const document = props.document;
  const anonymizedText = document?.anonymizedText ?? '';
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
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="Detecciones" value={String(totalEntities)} />
            <Metric label="Reemplazos" value={String(replacements)} />
          </div>
        ) : null}
      </div>

      <div className="mt-4 min-h-[360px] max-h-[560px] overflow-auto rounded-md border border-[#dfe3ef] bg-[#f8fafc]">
        {document ? (
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-[#111827]">
            {anonymizedText || 'Documento sin texto anonimizado disponible.'}
          </pre>
        ) : (
          <p className="p-4 text-sm text-[#6F7072]">Selecciona un documento.</p>
        )}
      </div>
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
    empty_batch: 'Selecciona al menos un documento.',
    empty_file: 'El archivo esta vacio.',
    file_too_large: 'El archivo supera el tamano permitido.',
    insufficient_role: 'Tu usuario no tiene permisos para esta accion.',
    invalid_credentials: 'Correo o contrasena incorrectos.',
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

function downloadLocalAnonymizedDocument(document: DocumentItem, text: string): void {
  const extension = outputExtensionFor(document);
  const blob =
    extension === '.pdf'
      ? createPdfBlob(text)
      : extension === '.doc'
        ? createWordBlob(text)
        : new Blob([text], { type: 'text/plain;charset=utf-8' });

  downloadBlob(blob, `anonimizado-${shortDocumentId(document.id)}${extension}`);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function outputExtensionFor(document: DocumentItem | null | undefined): '.doc' | '.pdf' | '.txt' {
  const extension = document?.validationSummary?.extension?.toLowerCase();
  const mimeType = document?.mimeType;

  if (extension === '.pdf' || mimeType === 'application/pdf') {
    return '.pdf';
  }

  if (
    extension === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return '.doc';
  }

  return '.txt';
}

function createWordBlob(text: string): Blob {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; }
    pre { font-family: Arial, sans-serif; white-space: pre-wrap; word-wrap: break-word; }
  </style>
</head>
<body>
  <pre>${escapeHtml(text)}</pre>
</body>
</html>`;

  return new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
}

function createPdfBlob(text: string): Blob {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const fontSize = 11;
  const lineHeight = 15;
  const maxCharsPerLine = 92;
  const maxLinesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
  const lines = wrapTextForPdf(text, maxCharsPerLine);
  const pages = chunkLines(lines.length > 0 ? lines : [''], maxLinesPerPage);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const pageObjectIds: number[] = [];

  pages.forEach((pageLines, index) => {
    const pageObjectId = 4 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const content = pdfContentStream(pageLines, {
      fontSize,
      lineHeight,
      margin,
      pageHeight,
    });

    pageObjectIds.push(pageObjectId);
    objects[pageObjectId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

  return new Blob([buildPdf(objects)], { type: 'application/pdf' });
}

function pdfContentStream(
  lines: readonly string[],
  options: { fontSize: number; lineHeight: number; margin: number; pageHeight: number },
): string {
  const firstBaseline = options.pageHeight - options.margin;
  const commands = [
    'BT',
    `/F1 ${options.fontSize} Tf`,
    `${options.margin} ${firstBaseline} Td`,
    `${options.lineHeight} TL`,
  ];

  lines.forEach((line, index) => {
    if (index > 0) {
      commands.push('T*');
    }

    if (line.length > 0) {
      commands.push(`<${utf16Hex(line)}> Tj`);
    }
  });
  commands.push('ET');

  return commands.join('\n');
}

function buildPdf(objects: readonly string[]): string {
  const header = '%PDF-1.4\n';
  const bodyParts: string[] = [];
  const offsets = [0];
  let length = header.length;

  objects.forEach((object, index) => {
    offsets.push(length);
    const objectText = `${index + 1} 0 obj\n${object}\nendobj\n`;

    bodyParts.push(objectText);
    length += objectText.length;
  });

  const xrefOffset = length;
  const xrefEntries = offsets.map((offset, index) => {
    if (index === 0) {
      return '0000000000 65535 f ';
    }

    return `${String(offset).padStart(10, '0')} 00000 n `;
  });
  const trailer = `xref\n0 ${offsets.length}\n${xrefEntries.join(
    '\n',
  )}\ntrailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return `${header}${bodyParts.join('')}${trailer}`;
}

function wrapTextForPdf(text: string, maxCharsPerLine: number): string[] {
  const output: string[] = [];

  for (const rawLine of text.replace(/\r\n?/gu, '\n').split('\n')) {
    if (rawLine.trim().length === 0) {
      output.push('');
      continue;
    }

    let currentLine = '';

    for (const word of rawLine.split(/\s+/u)) {
      if (word.length > maxCharsPerLine) {
        if (currentLine.length > 0) {
          output.push(currentLine);
          currentLine = '';
        }

        for (let index = 0; index < word.length; index += maxCharsPerLine) {
          output.push(word.slice(index, index + maxCharsPerLine));
        }

        continue;
      }

      const candidate = currentLine.length > 0 ? `${currentLine} ${word}` : word;

      if (candidate.length > maxCharsPerLine) {
        output.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }

    if (currentLine.length > 0) {
      output.push(currentLine);
    }
  }

  return output;
}

function chunkLines(lines: readonly string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < lines.length; index += chunkSize) {
    chunks.push([...lines.slice(index, index + chunkSize)]);
  }

  return chunks;
}

function utf16Hex(value: string): string {
  const bytes = [0xfe, 0xff];

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    bytes.push((code >> 8) & 0xff, code & 0xff);
  }

  return bytes
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function shortDocumentId(documentId: string): string {
  return documentId.slice(0, 8);
}
