(function () {
  'use strict';

  var TABLE = 'client_recommendations';
  var config = window.HERRHYTHM_SUPABASE || {};
  var db = null;

  function currentPage() {
    var path = window.location.pathname || '/';
    var page = path.split('/').filter(Boolean).pop() || 'index.html';
    return page.toLowerCase();
  }

  function pageLabel() {
    var title = (document.title || currentPage()).replace(/\s*[—|-]\s*HerRhythm Care.*$/i, '').trim();
    return title || currentPage();
  }

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function discoverSections() {
    var values = ['Header / Navigation'];
    var seen = new Set(values.map(function(v){return v.toLowerCase();}));

    document.querySelectorAll('section, main, article').forEach(function (el) {
      var label = cleanText(el.getAttribute('data-feedback-section'));
      if (!label) {
        var heading = el.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > div > h1, :scope > div > h2, :scope > div > h3');
        label = heading ? cleanText(heading.textContent) : '';
      }
      if (!label && el.id) {
        label = el.id.replace(/[-_]+/g, ' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
      }
      if (label && label.length <= 90 && !seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        values.push(label);
      }
    });

    ['Footer', 'Other'].forEach(function (label) {
      if (!seen.has(label.toLowerCase())) values.push(label);
    });
    return values;
  }

  function buildUI() {
    if (document.getElementById('clientFeedback')) return;

    var panel = document.createElement('aside');
    panel.className = 'client-feedback';
    panel.id = 'clientFeedback';
    panel.setAttribute('aria-label', 'Client recommendations');
    panel.innerHTML =
      '<div class="feedback-head"><div><span class="feedback-eyebrow">Client review</span><h2>Recommend a change</h2></div><button type="button" class="feedback-close" id="feedbackClose" aria-label="Close">×</button></div>' +
      '<p class="feedback-intro">Select the section you are reviewing, then describe the proposed change.</p>' +
      '<p class="feedback-page"><strong>Page:</strong> <span id="feedbackPageLabel"></span></p>' +
      '<form id="feedbackForm">' +
        '<label for="feedbackSection">Specific section</label>' +
        '<select id="feedbackSection" name="section" required></select>' +
        '<label for="feedbackComment">Recommendation / proposed change</label>' +
        '<textarea id="feedbackComment" rows="6" placeholder="Describe what should be changed..." required></textarea>' +
        '<label for="feedbackName">Your name <span>(optional)</span></label>' +
        '<input id="feedbackName" maxlength="100" placeholder="Client name">' +
        '<button type="submit" class="feedback-save" id="feedbackSave">＋ Save recommendation</button>' +
        '<div class="feedback-status" id="feedbackStatus" role="status" aria-live="polite"></div>' +
      '</form>' +
      '<div class="feedback-list-wrap"><div class="feedback-list-title"><strong>Recommendations for this page</strong><span id="feedbackCount">0</span></div><div id="feedbackList" class="feedback-list"><p class="feedback-empty">No recommendations saved yet.</p></div></div>';

    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'feedback-tab';
    tab.id = 'feedbackTab';
    tab.innerHTML = '✎ Client feedback';

    document.body.appendChild(panel);
    document.body.appendChild(tab);

    document.getElementById('feedbackPageLabel').textContent = pageLabel() + ' · ' + currentPage();
    var select = document.getElementById('feedbackSection');
    select.innerHTML = '<option value="">Select a section</option>' + discoverSections().map(function (section) {
      var opt = document.createElement('option');
      opt.value = section;
      opt.textContent = section;
      return opt.outerHTML;
    }).join('');
  }

  function setStatus(message, type) {
    var status = document.getElementById('feedbackStatus');
    if (!status) return;
    status.textContent = message || '';
    status.className = 'feedback-status' + (type ? ' ' + type : '');
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }

  function connect() {
    if (db) return true;
    if (!config.url || !config.key || !window.supabase || typeof window.supabase.createClient !== 'function') return false;
    db = window.supabase.createClient(config.url, config.key);
    return true;
  }

  function renderComments(comments) {
    var count = document.getElementById('feedbackCount');
    var list = document.getElementById('feedbackList');
    if (!count || !list) return;
    count.textContent = comments.length;
    if (!comments.length) {
      list.innerHTML = '<p class="feedback-empty">No recommendations saved for this page yet.</p>';
      return;
    }
    list.innerHTML = comments.map(function(item){
      var resolved = item.status === 'resolved';
      return '<div class="feedback-item' + (resolved?' resolved':'') + '">' +
        '<div class="feedback-item-top"><div class="feedback-item-section">' + escapeHtml(item.section) + '</div>' +
        '<span class="feedback-status-badge ' + (resolved?'resolved':'pending') + '">' + (resolved?'Resolved':'Pending') + '</span></div>' +
        '<p>' + escapeHtml(item.comment) + '</p>' +
        '<small>' + escapeHtml(formatDate(item.created_at)) + (item.name?' · '+escapeHtml(item.name):'') + '</small>' +
        (resolved?'':'<br><button type="button" class="feedback-resolve" data-feedback-id="'+escapeHtml(item.id)+'">✓ Mark as resolved</button>') +
        '</div>';
    }).join('');

    list.querySelectorAll('.feedback-resolve').forEach(function(button){
      button.addEventListener('click', async function(){
        if (!connect()) return setStatus('Supabase connection is unavailable.', 'error');
        var id = button.getAttribute('data-feedback-id');
        button.disabled = true;
        button.textContent = 'Saving...';
        var result = await db.from(TABLE).update({status:'resolved'}).eq('id',id);
        if (result.error) {
          button.disabled = false;
          button.textContent = '✓ Mark as resolved';
          console.error('Supabase status update error:',result.error);
          return setStatus('Could not update status: '+(result.error.message||'Unknown error'),'error');
        }
        setStatus('Recommendation marked as resolved.','success');
        loadComments();
      });
    });
  }

  async function loadComments() {
    if (!connect()) return setStatus('Supabase connection is unavailable.','error');
    var result = await db.from(TABLE)
      .select('id, page, section, comment, name, status, created_at')
      .eq('page', currentPage())
      .order('created_at',{ascending:false});
    if (result.error) {
      console.error('Supabase load error:',result.error);
      return setStatus('Could not load: '+(result.error.message||'Unknown error'),'error');
    }
    renderComments(result.data||[]);
  }

  function init() {
    buildUI();
    var panel=document.getElementById('clientFeedback');
    var tab=document.getElementById('feedbackTab');
    var close=document.getElementById('feedbackClose');
    var form=document.getElementById('feedbackForm');
    var save=document.getElementById('feedbackSave');

    tab.addEventListener('click',function(e){e.preventDefault();panel.classList.add('open');loadComments();});
    close.addEventListener('click',function(){panel.classList.remove('open');});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')panel.classList.remove('open');});

    form.addEventListener('submit',async function(e){
      e.preventDefault();
      var section=document.getElementById('feedbackSection').value.trim();
      var comment=document.getElementById('feedbackComment').value.trim();
      var name=document.getElementById('feedbackName').value.trim();
      if(!section||!comment)return setStatus('Please select a section and enter a recommendation.','error');
      if(!connect())return setStatus('Supabase connection is unavailable.','error');
      save.disabled=true;setStatus('Saving...','');
      var result=await db.from(TABLE).insert({page:currentPage(),section:section,comment:comment,name:name||null,status:'pending'}).select('id,page,section,comment,name,status,created_at').single();
      save.disabled=false;
      if(result.error){console.error('Supabase save error:',result.error);return setStatus('Could not save: '+(result.error.message||'Unknown error'),'error');}
      form.reset();setStatus('Recommendation saved successfully.','success');loadComments();
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
