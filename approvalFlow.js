import supabaseDefault, { requireSession as requireSessionDefault } from "./supabaseClient.js";
import { mountApprovalBlock } from "./approvalBlock.js";

function resolveNode(ref){
  if (!ref) return null;
  if (typeof ref === "string") return document.getElementById(ref);
  return ref;
}

export function createApprovalFlow({
  docKind,
  tableName,
  buildTitle,
  resolveObjectId,
  mountId = "approval-block-mount",
  mountSection,
  approverSection,
  approvalPicker,
  onApprovalEstablished,
  onApprovalRemoved,
  supabase = supabaseDefault,
  requireSession = requireSessionDefault
} = {}){
  const mountSectionNode = resolveNode(mountSection);
  const approverSectionNode = resolveNode(approverSection);
  let currentApprovalId = null;
  let currentRecordId = null;
  let currentUser = null;

  function revealMountSection(){
    if (mountSectionNode){
      mountSectionNode.hidden = false;
    }
  }

  function hideApproverSection(){
    if (approverSectionNode){
      approverSectionNode.hidden = true;
    }
  }

  function showApproverSection(){
    if (approverSectionNode){
      approverSectionNode.hidden = false;
    }
  }

  async function ensureUser(session){
    if (session?.user){
      currentUser = session.user;
      return currentUser;
    }
    if (currentUser){
      return currentUser;
    }
    const { user } = await requireSession();
    currentUser = user;
    return user;
  }

  async function updateAssignmentApprovers({ ids, names, approvalId }){
    if (!approvalId) return;
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const unique = Array.from(new Set(list));
    const nameMap = new Map();
    if (Array.isArray(names)){
      list.forEach((id, idx)=>{
        if (!nameMap.has(id) && names[idx]){
          nameMap.set(id, names[idx]);
        }
      });
    }
    const nameList = unique.map(id => nameMap.get(id) || "");
    await supabase
      .from("document_approval_assignments")
      .update({
        approver_ids: unique,
        approver_names: nameList,
        status: unique.length ? "in_review" : "draft"
      })
      .eq("id", approvalId);
  }

  async function sync(record, { session, isNew = false } = {}){
    if (!record || !record.id){
      return;
    }

    currentRecordId = record.id;
    currentApprovalId = record.approval_id || currentApprovalId || null;

    const user = await ensureUser(session);
    const mountNode = resolveNode(mountId);
    if (!mountNode){
      console.warn("[approvalFlow] mount node not found", mountId);
      return;
    }

    const title = typeof buildTitle === "function" ? buildTitle(record) : `Документ ${record.id.slice(0, 6)}`;
    const objectId = typeof resolveObjectId === "function" ? resolveObjectId(record) : null;
    const documentType = docKind ? `request_documents.${docKind}` : "request_documents";

    const needsCreation = !currentApprovalId;
    let selectedIds = [];
    let selectedNames = [];
    if (needsCreation && approvalPicker?.getSelectedIds){
      selectedIds = approvalPicker.getSelectedIds().slice();
    }
    if (needsCreation && approvalPicker?.getSelectedNames){
      selectedNames = approvalPicker.getSelectedNames().slice();
    }

    revealMountSection();

    const options = {
      mountId,
      docKind,
      docId: record.id,
      title,
      objectId: objectId || null,
      approvalId: currentApprovalId,
      documentType,
      documentNumber: record.number || null,
      sourceTable: tableName,
      onAssigneesLoaded: (info)=>{
        if (!info) return;
        if (approvalPicker?.setSelected){
          approvalPicker.setSelected(info.ids || []);
        }
      }
    };

    if (needsCreation){
      options.onApprovalCreated = async (newApprovalId)=>{
        currentApprovalId = newApprovalId;
        record.approval_id = newApprovalId;
        try{
          await supabase
            .from(tableName)
            .update({ approval_id: newApprovalId })
            .eq("id", record.id);
        }catch(linkError){
          console.warn("[approvalFlow] failed to link approval to record", linkError);
        }
        await updateAssignmentApprovers({
          ids: selectedIds,
          names: selectedNames,
          approvalId: newApprovalId
        });
        if (approvalPicker?.reset){
          approvalPicker.reset();
        }
        hideApproverSection();
        if (typeof onApprovalEstablished === "function"){
          try{
            await onApprovalEstablished(newApprovalId, record);
          }catch(cbError){
            console.warn("[approvalFlow] onApprovalEstablished callback failed", cbError);
          }
        }
      };
    }

    options.onApprovalRemoved = async ()=>{
      currentApprovalId = null;
      if (record){
        record.approval_id = null;
        record.status = "draft";
      }
      const updatePayload = { approval_id: null, status: "draft" };
      if (tableName && record?.id){
        try{
          await supabase
            .from(tableName)
            .update(updatePayload)
            .eq("id", record.id);
        }catch(resetError){
          console.warn("[approvalFlow] failed to reset approval link", resetError);
        }
      }
      if (approvalPicker?.reset){
        approvalPicker.reset();
      }
      if (approvalPicker?.setSelected){
        approvalPicker.setSelected([]);
      }
      approvalPicker?.clearQuery?.();
      showApproverSection();
      if (typeof onApprovalRemoved === "function"){
        try{
          await onApprovalRemoved(record);
        }catch(cbError){
          console.warn("[approvalFlow] onApprovalRemoved callback failed", cbError);
        }
      }
      if (record?.id){
        try{
          await sync(record, { session, isNew: true });
        }catch(syncError){
          console.warn("[approvalFlow] resync after removal failed", syncError);
        }
      }
    };

    await mountApprovalBlock(options);

    if (currentApprovalId){
      showApproverSection();
    } else if (!needsCreation && !isNew){
      showApproverSection();
    }
  }

  return {
    sync,
    getApprovalId: ()=> currentApprovalId,
    getRecordId: ()=> currentRecordId,
    hideApproverSection,
    showApproverSection,
    revealMountSection
  };
}
