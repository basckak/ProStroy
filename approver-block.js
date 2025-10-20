const approverState = {
      list: [],
      map: new Map(),
      selected: new Set(),
      loading: true,
      error: null,
      outsideBound: false
    };

    await loadHeader();
    const { data:{ session } } = await supabase.auth.getSession();
    if (!session) location.replace("./index.html");
    const user = session.user;

    await loadObjectDirectory();
    bindDestinationSelect();
    bindApproverDropdown();
    loadApproverDirectory().catch((e)=>{
      console.error(e);
    });

    