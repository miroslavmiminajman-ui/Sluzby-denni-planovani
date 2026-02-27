import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  Calculator, 
  CheckCircle2, 
  TrendingUp, 
  Calendar, 
  FileText, 
  ChevronDown, 
  Target,
  Info,
  PencilLine,
  FileDown,
  Star,
  Settings2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { CalculationResult } from './types';
import { getRemainingDaysInfo } from './utils/dateUtils';

const App: React.FC = () => {
  const [allCalculations, setAllCalculations] = useState<CalculationResult[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [manualOverrides, setManualOverrides] = useState<Record<string, { serviceAsistRevenue?: number; revenueRR?: number }>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(localStorage.getItem('defaultBranch'));
  
  // Váha víkendu (0.6 = 60 %) - uloženo v localStorage
  const [weekendWeight, setWeekendWeight] = useState<number>(() => {
    const saved = localStorage.getItem('weekendWeight');
    return saved ? parseFloat(saved) : 0.6;
  });

  const resultsRef = useRef<HTMLDivElement>(null);

  // Uložení váhy víkendu při změně
  useEffect(() => {
    localStorage.setItem('weekendWeight', weekendWeight.toString());
  }, [weekendWeight]);

  // Automatické odscrollování k výsledkům po zpracování
  useEffect(() => {
    if (allCalculations.length > 0 && selectedBranch && resultsRef.current && !isProcessing) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [allCalculations, selectedBranch, isProcessing]);

  const availableBranches = useMemo(() => {
    return Array.from(new Set(allCalculations.map(c => c.branchName))).sort();
  }, [allCalculations]);

  // Hlavní logika výpočtu s podporou manuálních změn a nastavitelné váhy víkendu
  const filteredResult = useMemo(() => {
    if (!selectedBranch) return null;
    const baseData = allCalculations.find(c => c.branchName === selectedBranch);
    if (!baseData) return null;

    // Pokud existuje manuální override, použijeme ho a přepočítáme cíl
    const branchOverrides = manualOverrides[selectedBranch];
    const currentServiceAsist = branchOverrides?.serviceAsistRevenue ?? baseData.serviceAsistRevenue;
    const currentRevenueRR = branchOverrides?.revenueRR ?? baseData.revenueRR;
    
    const daysInfo = getRemainingDaysInfo();
    // weightedDays = počet všedních dní + (váha * počet víkendových dní)
    const weightedDays = daysInfo.weekdays + (weekendWeight * daysInfo.weekends);
    const remainingTotalRevenue = (currentRevenueRR * baseData.planAsrServicesRevenue) - currentServiceAsist;
    
    // finalValue je cíl pro 1.0 (všední den)
    const recalculatedFinalValue = weightedDays > 0 ? remainingTotalRevenue / weightedDays : 0;

    return {
      ...baseData,
      serviceAsistRevenue: currentServiceAsist,
      revenueRR: currentRevenueRR,
      finalValue: recalculatedFinalValue
    };
  }, [allCalculations, selectedBranch, manualOverrides, weekendWeight]);

  // Výpočet progressu pro zobrazení v UI
  const progressStats = useMemo(() => {
    if (!filteredResult) return { percent: 0, target: 0 };
    const target = filteredResult.revenueRR * filteredResult.planAsrServicesRevenue;
    const current = filteredResult.serviceAsistRevenue;
    const percent = target > 0 ? (current / target) * 100 : 0;
    return { percent, target };
  }, [filteredResult]);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setFileName(file.name);
    setAllCalculations([]);
    setManualOverrides({});
    setSelectedBranch("");
    
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const ab = e.target?.result;
          const wb = XLSX.read(ab, { type: 'array' });
          
          const targetSheetName = "Branch Performance";
          let ws = wb.Sheets[targetSheetName];
          if (!ws) ws = wb.Sheets[wb.SheetNames[0]];

          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          
          if (rows.length < 5) {
            throw new Error("Soubor je příliš krátký. Záhlaví musí být na 5. řádku.");
          }

          const headerRow = rows[4];
          const findColIndex = (names: string[]) => {
            return headerRow.findIndex(cell => 
              cell && names.some(name => String(cell).toLowerCase().trim() === name.toLowerCase().trim())
            );
          };

          const colIdxBranch = findColIndex(['BranchName', 'Pobočka']);
          const colIdxRevRR = findColIndex(['Revenue RR']);
          const colIdxServAsist = findColIndex(['Service Asist Revenue']);
          const colIdxPlanAsr = findColIndex(['Plan ASR Services/Revenue']);

          if (colIdxBranch === -1 || colIdxRevRR === -1 || colIdxServAsist === -1 || colIdxPlanAsr === -1) {
            setError("Nepodařilo se najít všechny sloupce. Zkontrolujte názvy v Excelu na 5. řádku.");
            setIsProcessing(false);
            return;
          }

          const daysInfo = getRemainingDaysInfo();
          const results: CalculationResult[] = [];

          for (let i = 5; i < rows.length; i++) {
            const row = rows[i];
            const branchVal = row[colIdxBranch]?.toString().trim();
            
            if (branchVal) {
              const parseVal = (val: any) => {
                if (typeof val === 'number') return val;
                if (!val) return 0;
                const cleaned = String(val).replace(/\s/g, '').replace(',', '.');
                const num = parseFloat(cleaned);
                return isNaN(num) ? 0 : num;
              };

              const revRR = Math.round(parseVal(row[colIdxRevRR]));
              const planAsr = parseVal(row[colIdxPlanAsr]);
              const serAsist = Math.round(parseVal(row[colIdxServAsist]));

              if (revRR === 0 && planAsr === 0) continue;

              results.push({
                branchName: branchVal,
                revenueRR: revRR,
                planAsrServicesRevenue: planAsr,
                serviceAsistRevenue: serAsist,
                daysRemaining: daysInfo.total,
                weekdaysRemaining: daysInfo.weekdays,
                weekendsRemaining: daysInfo.weekends,
                isTodayWeekend: daysInfo.isTodayWeekend,
                finalValue: 0, 
                rawRow: row
              });
            }
          }

          setAllCalculations(results);
          
          const saved = localStorage.getItem('defaultBranch');
          if (saved && results.some(r => r.branchName === saved)) {
            setSelectedBranch(saved);
          } else {
            setSelectedBranch("");
          }
          
        } catch (err: any) {
          setError(err.message);
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      setError("Chyba při nahrávání.");
      setIsProcessing(false);
    }
  };

  const handleUpdateOverride = (field: 'serviceAsistRevenue' | 'revenueRR', newValue: number) => {
    if (!selectedBranch) return;
    setManualOverrides(prev => ({
      ...prev,
      [selectedBranch]: {
        ...(prev[selectedBranch] || {}),
        [field]: newValue
      }
    }));
  };

  const handleSetDefaultBranch = () => {
    if (selectedBranch) {
      localStorage.setItem('defaultBranch', selectedBranch);
      setDefaultBranch(selectedBranch);
    }
  };

  const handleExportPDF = async () => {
    if (!resultsRef.current || !filteredResult) return;

    const element = resultsRef.current;
    const indicators = element.querySelectorAll('.edit-indicator');
    indicators.forEach(el => (el as HTMLElement).style.opacity = '0');

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const finalWidth = imgWidth * ratio * 0.95;
      const finalHeight = imgHeight * ratio * 0.95;
      
      const x = (pdfWidth - finalWidth) / 2;
      const y = (pdfHeight - finalHeight) / 2;

      pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
      pdf.save(`Report_${filteredResult.branchName.replace(/\s+/g, '_')}_${new Date().toLocaleDateString('cs-CZ')}.pdf`);
    } catch (err) {
      console.error("Chyba při exportu PDF:", err);
      alert("Nepodařilo se vygenerovat PDF. Zkuste to prosím znovu.");
    } finally {
      indicators.forEach(el => (el as HTMLElement).style.opacity = '');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-12 font-sans text-slate-900">
      <header className="mb-12 flex flex-col items-center">
        <div className="bg-blue-600 p-4 rounded-3xl shadow-xl mb-6">
          <Calculator className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl md:text-4xl font-black mb-3 text-center">
          Služby - <span className="text-blue-600">denní plánování</span>
        </h1>
      </header>

      <main className="space-y-10">
        <section>
          <div className={`relative border-4 border-dashed rounded-[2.5rem] p-12 text-center transition-all duration-300
            ${fileName ? 'border-green-200 bg-green-50/30' : 'border-slate-200 bg-white hover:border-blue-300 shadow-sm hover:shadow-md'}`}>
            {!fileName && (
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            )}
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${fileName ? 'bg-green-100 text-green-600' : 'bg-blue-50 text-blue-500'}`}>
                {fileName ? <CheckCircle2 className="w-8 h-8" /> : <FileText className="w-8 h-8" />}
              </div>
              <div>
                <p className="text-xl font-bold text-slate-800">{fileName || 'Vyber aktuální Denní Hlášení'}</p>
              </div>
              {fileName && (
                <button 
                  onClick={() => setFileName(null)} 
                  className="text-xs text-rose-500 font-black uppercase tracking-widest hover:text-rose-600 transition-colors relative z-20 mt-2"
                >
                  Nahrát jiný soubor
                </button>
              )}
            </div>
          </div>
        </section>

        {allCalculations.length > 0 && (
          <section className="max-w-3xl mx-auto">
            <div className="bg-white rounded-[2.5rem] p-6 shadow-xl border border-slate-100 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                {/* Výběr pobočky */}
                <div className="space-y-3">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Zvolená pobočka</label>
                  <div className="flex gap-2">
                    <div className="relative flex-grow">
                      <select 
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        className="w-full appearance-none bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold text-lg focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="">Vyberte pobočku...</option>
                        {availableBranches.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                      <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <ChevronDown className="w-5 h-5" />
                      </div>
                    </div>
                    {selectedBranch && (
                      <button
                        onClick={handleSetDefaultBranch}
                        title="Nastavit jako moji výchozí pobočku"
                        className={`p-4 rounded-2xl border-2 transition-all flex items-center justify-center ${defaultBranch === selectedBranch ? 'bg-amber-100 border-amber-200 text-amber-600' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-amber-200 hover:text-amber-500'}`}
                      >
                        <Star className={`w-6 h-6 ${defaultBranch === selectedBranch ? 'fill-amber-500' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Nastavení váhy víkendu */}
                <div className="space-y-3">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Váha víkendu (%)</label>
                  <div className="flex items-center gap-3 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-3.5 shadow-sm">
                    <Settings2 className="w-5 h-5 text-slate-400" />
                    <input 
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(weekendWeight * 100)}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) setWeekendWeight(val / 100);
                      }}
                      className="bg-transparent font-bold text-lg w-full outline-none text-slate-700"
                    />
                    <span className="font-black text-slate-300">%</span>
                  </div>
                </div>
              </div>

              {selectedBranch && (
                <div className="pt-4">
                  <button
                    onClick={handleExportPDF}
                    className="w-full px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-100"
                  >
                    <FileDown className="w-6 h-6" />
                    <span>Export do PDF</span>
                  </button>
                </div>
              )}
              
              {!selectedBranch && (
                <div className="text-center py-4 text-slate-400 flex flex-col items-center gap-2">
                  <Info className="w-8 h-8 opacity-20" />
                  <p className="font-medium text-sm">Vyberte pobočku ze seznamu pro zobrazení výpočtu.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {error && <div className="p-8 bg-rose-50 border-2 border-rose-100 rounded-3xl text-rose-700 font-bold text-center animate-pulse">{error}</div>}

        {isProcessing && (
          <div className="flex flex-col items-center justify-center py-24 gap-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
            <p className="text-slate-400 font-bold tracking-widest uppercase text-xs animate-pulse text-center">Analyzuji report...</p>
          </div>
        )}

        {filteredResult && !isProcessing && (
          <div className="animate-in fade-in zoom-in-95 duration-700 flex justify-center pt-4 overflow-visible">
            <div 
              ref={resultsRef}
              className="bg-white shadow-2xl border border-slate-100 rounded-[3.5rem] overflow-hidden flex flex-col md:flex-row min-h-[600px] w-full max-w-5xl mx-auto"
            >
              <div className="md:w-[40%] bg-slate-900 p-10 lg:p-12 text-white flex flex-col justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-3 mb-10 lg:mb-16 opacity-50">
                    <TrendingUp className="w-6 h-6" />
                    <span className="text-xs font-black uppercase tracking-[0.3em]">Cíl pro všední den</span>
                  </div>
                  
                  <div className="mb-4">
                    <span className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tighter block mb-2 leading-none">
                      {Math.max(0, Math.round(filteredResult.finalValue)).toLocaleString('cs-CZ')}
                    </span>
                    <p className="text-slate-400 text-lg lg:text-xl font-medium">CZK / všední den</p>
                  </div>
                  
                  <div className="mt-8 lg:mt-10 inline-flex flex-col items-start gap-3">
                    <div className="px-5 py-2.5 bg-slate-800 rounded-2xl border border-slate-700 font-bold text-base lg:text-lg shadow-lg">
                      {filteredResult.branchName}
                    </div>
                    {filteredResult.isTodayWeekend ? (
                      <div className="flex items-center gap-2 text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded-xl border border-amber-400/20">
                        <Info className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Dnes víkend ({Math.max(0, Math.round(filteredResult.finalValue * weekendWeight)).toLocaleString('cs-CZ')} CZK)
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-xl border border-emerald-400/20">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Dnes všední den</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-12 pt-10 border-t border-slate-800 flex flex-col gap-4">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-slate-400">
                      <Calendar className="w-5 h-5 text-blue-500" />
                      <p className="text-sm font-bold">
                        Zbývá <strong className="text-white">{filteredResult.daysRemaining} dní</strong> v měsíci.
                      </p>
                    </div>
                    <div className="ml-8 space-y-1.5">
                      <p className="text-xs text-slate-500 font-medium">
                        • <strong className="text-slate-300">{filteredResult.weekdaysRemaining}</strong> všedních dní (100 %)
                      </p>
                      <p className="text-xs text-slate-500 font-medium">
                        • <strong className="text-slate-300">{filteredResult.weekendsRemaining}</strong> sobot a nedělí ({Math.round(weekendWeight * 100)} %)
                      </p>
                    </div>
                    <p className="text-[10px] text-slate-500 italic mt-2 leading-tight">
                      *Ztráta z víkendů ({Math.round((1 - weekendWeight) * 100)} %) je rozpočítána a navyšuje cíl pro všední den.
                    </p>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-6">
                    Report: {new Date().toLocaleDateString('cs-CZ')}
                  </p>
                </div>
              </div>

              <div className="md:w-[60%] p-10 lg:p-16 space-y-6 lg:space-y-10 bg-white flex flex-col justify-center overflow-hidden">
                <div className="space-y-2">
                  <h3 className="text-3xl lg:text-4xl font-black text-slate-900 tracking-tight leading-none">Aktuální vývoj</h3>
                </div>

                <div className="space-y-3 lg:space-y-5">
                  <ValueRow 
                    label="PREDIKOVANÝ OBRAT" 
                    value={filteredResult.revenueRR} 
                    editable 
                    onValueChange={(val: number) => handleUpdateOverride('revenueRR', val)}
                  />
                  <ValueRow label="PLÁN SLUŽEB" value={filteredResult.planAsrServicesRevenue} isPercent truncate />
                  <ValueRow 
                    label="ASR SLUŽBY" 
                    value={filteredResult.serviceAsistRevenue} 
                    isGreen 
                    editable 
                    onValueChange={(val: number) => handleUpdateOverride('serviceAsistRevenue', val)}
                  />
                </div>

                <div className="mt-6 lg:mt-12 p-8 lg:p-10 bg-slate-50 rounded-[3rem] border border-slate-100 relative overflow-hidden group">
                  <div className="flex items-center gap-3 mb-6 text-slate-400 relative z-10">
                    <Target className="w-5 h-5 text-blue-500" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Aktuální plnění měsíčního plánu</span>
                  </div>
                  
                  <div className="space-y-4 relative z-10">
                    <div className="flex justify-between items-end">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aktuální stav</span>
                        <span className="text-lg font-black text-slate-900">
                          {filteredResult.serviceAsistRevenue.toLocaleString('cs-CZ')} CZK
                        </span>
                      </div>
                      <div className="text-right flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cíl</span>
                        <span className="text-lg font-black text-blue-600">
                          {Math.round(progressStats.target).toLocaleString('cs-CZ')} CZK
                        </span>
                      </div>
                    </div>

                    <div className="relative h-6 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                      <div 
                        className="absolute top-0 left-0 h-full bg-blue-600 rounded-full transition-all duration-1000 ease-out shadow-lg"
                        style={{ width: `${Math.min(progressStats.percent, 100)}%` }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20"></div>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <div className="bg-white px-6 py-2 rounded-2xl border border-slate-200 shadow-sm flex items-baseline gap-2">
                        <span className="text-2xl font-black text-slate-900">
                          {progressStats.percent.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs font-black text-slate-400 uppercase">% splněno</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const ValueRow = ({ label, value, isPercent, isMinus, isGreen, truncate, editable, onValueChange }: any) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value.toString());

  useEffect(() => {
    setTempValue(value.toString());
  }, [value]);

  const handleFinishEdit = () => {
    setIsEditing(false);
    const num = parseFloat(tempValue.replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(num)) {
      onValueChange?.(num);
    } else {
      setTempValue(value.toString());
    }
  };

  const formattedVal = useMemo(() => {
    if (isPercent) {
      const percentVal = value * 100;
      return (truncate ? Math.floor(percentVal * 100) / 100 : percentVal).toLocaleString('cs-CZ', { 
        minimumFractionDigits: truncate ? 2 : 1, 
        maximumFractionDigits: truncate ? 2 : 1 
      });
    }
    return Math.round(value).toLocaleString('cs-CZ');
  }, [value, isPercent, truncate]);

  const getTextColor = () => {
    if (isMinus) return 'text-rose-500';
    if (isGreen) return 'text-emerald-500';
    return 'text-slate-900';
  };

  return (
    <div className={`flex items-center justify-between p-4 lg:p-7 border transition-all 
      ${editable 
        ? 'bg-blue-50/40 border-blue-100 rounded-[2rem] hover:border-blue-300 hover:bg-blue-50/60 cursor-text group/row shadow-sm' 
        : 'bg-white border-slate-100 rounded-3xl shadow-sm hover:border-blue-100'}`}
      onClick={() => editable && !isEditing && setIsEditing(true)}
    >
      <div className="flex items-center gap-2">
        <span className="text-slate-400 font-bold text-[10px] lg:text-sm tracking-wide uppercase shrink-0">{label}</span>
        {editable && (
          <PencilLine className={`w-3 h-3 text-blue-500 transition-opacity edit-indicator ${isEditing ? 'opacity-0' : 'opacity-40 group-hover/row:opacity-100'}`} />
        )}
      </div>
      
      <div className="flex items-baseline gap-2 shrink-0">
        {isEditing ? (
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              onBlur={handleFinishEdit}
              onKeyDown={(e) => e.key === 'Enter' && handleFinishEdit()}
              className={`text-2xl lg:text-3xl font-black ${getTextColor()} bg-white shadow-inner border border-blue-200 rounded-xl px-3 py-1 outline-none w-36 text-right`}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <span className={`text-2xl lg:text-3xl font-black ${getTextColor()} transition-colors`}>
            {isMinus && "− "}{formattedVal}
          </span>
        )}
        <span className="text-[10px] lg:text-xs text-slate-300 font-black uppercase">{isPercent ? '%' : 'CZK'}</span>
      </div>
    </div>
  );
};

export default App;