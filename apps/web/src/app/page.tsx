'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Files,
  FileText,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

export default function HomePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadMode, setUploadMode] = useState<UploadMode>('single');
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedDocument = useMemo(() => {
    return jobDetail?.documents.find((document) => document.id === selectedDocumentId) ?? null;
  }, [jobDetail, selectedDocumentId]);
  const isLocalJob = useMemo(() => {
    return jobDetail?.documents.some((document) => document.anonymizedText !== undefined) ?? false;
  }, [jobDetail]);

  const canUpload = user?.role === 'admin' || user?.role === 'operator';
  const canReview = user?.role === 'admin' || user?.role === 'reviewer';

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

  async function handleLogout() {
    setBusy(true);

    try {
      await logout();
      setUser(null);
      setJobDetail(null);
      setSelectedDocumentId(null);
      setDetections([]);
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
      setNotice(
        upload.documents.length === 1 ? 'Documento procesado' : 'Lote procesado',
      );
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
        downloadTextFile(documentId, localDocument.anonymizedText ?? '');
        return;
      }

      const blob = await downloadAnonymized(documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `anonymized-${documentId}.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
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
            <p className="mt-5 border-t border-[#dfe3ef] pt-4 text-center text-xs leading-5 text-[#6F7072]">
              Plataforma de uso exclusivo para el equipo autorizado de{' '}
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
                {user.email} · {roleLabel(user.role)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
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
              <DetectionPanel document={selectedDocument} detections={detections} />
            </div>
          ) : (
            <div className="p-8 text-sm text-[#6F7072]">
              Carga un documento o un lote para ver resultados.
            </div>
          )}
        </section>
      </div>
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
          <div className="mt-3 grid gap-2 text-sm text-[#374151] sm:grid-cols-3">
            <span>{formatBytes(document.fileSizeBytes)}</span>
            <span>{totalEntities} detección(es)</span>
            <span>{replacements} reemplazo(s)</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="icon-button"
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

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Admin',
    operator: 'Operador',
    reviewer: 'Revisor',
  };

  return labels[role] ?? role;
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
    request_failed: 'No se pudo completar la solicitud.',
    too_many_files: 'El lote supera la cantidad maxima permitida.',
    unsafe_file_name: 'El nombre del archivo no es seguro.',
    unsupported_extension: 'Formato no soportado. Usa TXT, PDF o DOCX.',
  };

  return messages[message] ?? message;
}

function downloadTextFile(documentId: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `anonymized-${documentId}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}
