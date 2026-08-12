import { supabase } from './supabase.js'

let isAdminPanelOpen = false

function getNextSortOrder(items) {
  const highestSortOrder = items.reduce(
    (highest, item) =>
      Math.max(highest, Number(item.sort_order) || 0),
    0
  )

  return highestSortOrder + 1
}

async function handleAddMember(
  event,
  members,
  refresh
) {
  event.preventDefault()

  const form = event.currentTarget
  const submitButton = form.querySelector('button')
  const displayName =
    form.elements.displayName.value.trim()
  const part = form.elements.part.value.trim()

  if (!displayName || !part) {
    alert('멤버 이름과 파트를 모두 입력해주세요.')
    return
  }

  submitButton.disabled = true

  const { error } = await supabase
    .from('band_members')
    .insert({
      display_name: displayName,
      part,
      role: 'member',
      is_approved: false,
      is_active: true,
      sort_order: getNextSortOrder(members)
    })

  if (error) {
    console.error(error)
    alert(`멤버 추가 실패: ${error.message}`)
    submitButton.disabled = false
    return
  }

  await refresh()
}

async function handleAddCategory(
  event,
  categories,
  refresh
) {
  event.preventDefault()

  const form = event.currentTarget
  const submitButton = form.querySelector('button')
  const name =
    form.elements.categoryName.value.trim()
  const color = form.elements.categoryColor.value

  if (!name) {
    alert('카테고리 이름을 입력해주세요.')
    return
  }

  submitButton.disabled = true

  const { error } = await supabase
    .from('practice_categories')
    .insert({
      name,
      color,
      is_active: true,
      sort_order: getNextSortOrder(categories)
    })

  if (error) {
    console.error(error)
    alert(`카테고리 추가 실패: ${error.message}`)
    submitButton.disabled = false
    return
  }

  await refresh()
}

async function updateActiveState(
  table,
  id,
  isActive,
  checkbox,
  refresh
) {
  checkbox.disabled = true

  const { error } = await supabase
    .from(table)
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) {
    console.error(error)
    checkbox.checked = !isActive
    checkbox.disabled = false
    alert(`상태 변경 실패: ${error.message}`)
    return
  }

  await refresh()
}

async function handleUpdateMember(
  member,
  displayNameInput,
  partInput,
  saveButton,
  refresh
) {
  const displayName =
    displayNameInput.value.trim()
  const part = partInput.value.trim()

  if (!displayName || !part) {
    alert('멤버 이름과 파트를 모두 입력해주세요.')
    return
  }

  const hasNoChanges =
    displayName === member.display_name &&
    part === member.part

  if (hasNoChanges) {
    alert('수정된 내용이 없습니다.')
    return
  }

  saveButton.disabled = true

  const { error } = await supabase
    .from('band_members')
    .update({
      display_name: displayName,
      part
    })
    .eq('id', member.id)

  if (error) {
    console.error(error)
    alert(`멤버 수정 실패: ${error.message}`)
    saveButton.disabled = false
    return
  }

  await refresh()
}

async function handleDeleteMember(
  member,
  deleteButton,
  refresh
) {
  if (member.user_id) {
    alert(
      '계정이 연결된 멤버는 삭제할 수 없습니다. ' +
      '사용 중지로 변경해주세요.'
    )
    return
  }

  deleteButton.disabled = true

  const {
    count,
    error: countError
  } = await supabase
    .from('practice_logs')
    .select(
      'id',
      {
        count: 'exact',
        head: true
      }
    )
    .eq('member_id', member.id)

  if (countError) {
    console.error(countError)
    alert(
      `멤버 사용 여부 확인 실패: ${countError.message}`
    )
    deleteButton.disabled = false
    return
  }

  if ((count ?? 0) > 0) {
    alert(
      `연습 기록 ${count}개가 연결된 멤버입니다. ` +
      '삭제할 수 없으므로 사용 중지로 변경해주세요.'
    )
    deleteButton.disabled = false
    return
  }

  const confirmed = window.confirm(
    `"${member.display_name}" 멤버를 삭제할까요?`
  )

  if (!confirmed) {
    deleteButton.disabled = false
    return
  }

  const { error } = await supabase
    .from('band_members')
    .delete()
    .eq('id', member.id)

  if (error) {
    console.error(error)
    alert(`멤버 삭제 실패: ${error.message}`)
    deleteButton.disabled = false
    return
  }

  await refresh()
}

function renderMemberList(
  list,
  members,
  currentMember,
  refresh
) {
  const fragment =
    document.createDocumentFragment()

  members.forEach((member) => {
    const item = document.createElement('div')
    item.className =
      'admin-item member-admin-item'

    const content =
      document.createElement('div')
    content.className = 'member-edit-content'

    const editor =
      document.createElement('div')
    editor.className = 'member-editor'

    const displayNameInput =
      document.createElement('input')
    displayNameInput.className =
      'member-text-input'
    displayNameInput.type = 'text'
    displayNameInput.value =
      member.display_name
    displayNameInput.maxLength = 100
    displayNameInput.setAttribute(
      'aria-label',
      '멤버 이름'
    )

    const partInput =
      document.createElement('input')
    partInput.className = 'member-text-input'
    partInput.type = 'text'
    partInput.value = member.part
    partInput.maxLength = 100
    partInput.setAttribute(
      'aria-label',
      '파트'
    )

    editor.append(
      displayNameInput,
      partInput
    )

    const metadata =
      document.createElement('span')
    metadata.className = 'admin-item-meta'

    const roleLabel =
      member.role === 'admin'
        ? '관리자'
        : '멤버'

    const accountLabel = member.user_id
      ? '계정 연결됨'
      : '계정 미연결'

    const approvalLabel = member.is_approved
      ? '승인됨'
      : '미승인'

    metadata.textContent =
      `${roleLabel} · ${accountLabel} · ${approvalLabel}`

    content.append(editor, metadata)

    const actions =
      document.createElement('div')
    actions.className = 'member-actions'

    const toggleLabel =
      document.createElement('label')
    toggleLabel.className = 'status-toggle'

    const checkbox =
      document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = member.is_active

    const statusText =
      document.createElement('span')

    const isCurrentMember =
      member.id === currentMember.id

    if (isCurrentMember) {
      checkbox.disabled = true
      statusText.textContent = '현재 관리자'
      toggleLabel.title =
        '현재 로그인한 관리자는 비활성화할 수 없습니다.'
    } else {
      statusText.textContent = member.is_active
        ? '사용 중'
        : '사용 중지'

      checkbox.addEventListener('change', () => {
        void updateActiveState(
          'band_members',
          member.id,
          checkbox.checked,
          checkbox,
          refresh
        )
      })
    }

    const saveButton =
      document.createElement('button')
    saveButton.className =
      'member-action-button member-save-button'
    saveButton.type = 'button'
    saveButton.textContent = '수정 저장'

    saveButton.addEventListener('click', () => {
      void handleUpdateMember(
        member,
        displayNameInput,
        partInput,
        saveButton,
        refresh
      )
    })

    const deleteButton =
      document.createElement('button')
    deleteButton.className =
      'member-action-button member-delete-button'
    deleteButton.type = 'button'
    deleteButton.textContent = '삭제'

    if (member.user_id || isCurrentMember) {
      deleteButton.disabled = true
      deleteButton.title =
        '계정이 연결된 멤버는 삭제할 수 없습니다.'
    } else {
      deleteButton.addEventListener(
        'click',
        () => {
          void handleDeleteMember(
            member,
            deleteButton,
            refresh
          )
        }
      )
    }

    toggleLabel.append(
      checkbox,
      statusText
    )

    actions.append(
      toggleLabel,
      saveButton,
      deleteButton
    )

    item.append(content, actions)
    fragment.append(item)
  })

  list.replaceChildren(fragment)
}

async function handleUpdateCategory(
  category,
  nameInput,
  colorInput,
  saveButton,
  refresh
) {
  const name = nameInput.value.trim()
  const color = colorInput.value

  if (!name) {
    alert('카테고리 이름을 입력해주세요.')
    nameInput.focus()
    return
  }

  const hasNoChanges =
    name === category.name &&
    color.toLowerCase() ===
      category.color.toLowerCase()

  if (hasNoChanges) {
    alert('수정된 내용이 없습니다.')
    return
  }

  saveButton.disabled = true

  const { error } = await supabase
    .from('practice_categories')
    .update({ name, color })
    .eq('id', category.id)

  if (error) {
    console.error(error)
    alert(`카테고리 수정 실패: ${error.message}`)
    saveButton.disabled = false
    return
  }

  await refresh()
}

async function handleDeleteCategory(
  category,
  deleteButton,
  refresh
) {
  deleteButton.disabled = true

  const {
    count,
    error: countError
  } = await supabase
    .from('practice_logs')
    .select(
      'id',
      {
        count: 'exact',
        head: true
      }
    )
    .eq('category_id', category.id)

  if (countError) {
    console.error(countError)
    alert(
      `카테고리 사용 여부 확인 실패: ${countError.message}`
    )
    deleteButton.disabled = false
    return
  }

  if ((count ?? 0) > 0) {
    alert(
      `연습 기록 ${count}개가 연결된 카테고리입니다. ` +
      '삭제할 수 없으므로 사용 중지로 변경해주세요.'
    )
    deleteButton.disabled = false
    return
  }

  const confirmed = window.confirm(
    `"${category.name}" 카테고리를 삭제할까요?`
  )

  if (!confirmed) {
    deleteButton.disabled = false
    return
  }

  const { error } = await supabase
    .from('practice_categories')
    .delete()
    .eq('id', category.id)

  if (error) {
    console.error(error)
    alert(`카테고리 삭제 실패: ${error.message}`)
    deleteButton.disabled = false
    return
  }

  await refresh()
}

function renderCategoryList(
  list,
  categories,
  refresh
) {
  const fragment =
    document.createDocumentFragment()

  categories.forEach((category) => {
    const item = document.createElement('div')
    item.className =
      'admin-item category-admin-item'

    const editor = document.createElement('div')
    editor.className = 'category-editor'

    const colorInput =
      document.createElement('input')
    colorInput.className = 'category-color-input'
    colorInput.type = 'color'
    colorInput.value = category.color
    colorInput.setAttribute(
      'aria-label',
      `${category.name} 표시 색상`
    )

    const nameInput =
      document.createElement('input')
    nameInput.className = 'category-name-input'
    nameInput.type = 'text'
    nameInput.value = category.name
    nameInput.maxLength = 100
    nameInput.setAttribute(
      'aria-label',
      '카테고리 이름'
    )

    editor.append(colorInput, nameInput)

    const actions =
      document.createElement('div')
    actions.className = 'category-actions'

    const toggleLabel =
      document.createElement('label')
    toggleLabel.className = 'status-toggle'

    const checkbox =
      document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = category.is_active

    const statusText =
      document.createElement('span')
    statusText.textContent = category.is_active
      ? '사용 중'
      : '사용 중지'

    checkbox.addEventListener('change', () => {
      void updateActiveState(
        'practice_categories',
        category.id,
        checkbox.checked,
        checkbox,
        refresh
      )
    })

    const saveButton =
      document.createElement('button')
    saveButton.className =
      'category-action-button category-save-button'
    saveButton.type = 'button'
    saveButton.textContent = '수정 저장'
    saveButton.addEventListener('click', () => {
      void handleUpdateCategory(
        category,
        nameInput,
        colorInput,
        saveButton,
        refresh
      )
    })

    const deleteButton =
      document.createElement('button')
    deleteButton.className =
      'category-action-button category-delete-button'
    deleteButton.type = 'button'
    deleteButton.textContent = '삭제'
    deleteButton.addEventListener('click', () => {
      void handleDeleteCategory(
        category,
        deleteButton,
        refresh
      )
    })

    toggleLabel.append(checkbox, statusText)

    actions.append(
      toggleLabel,
      saveButton,
      deleteButton
    )

    item.append(editor, actions)
    fragment.append(item)
  })

  list.replaceChildren(fragment)
}

export function renderAdminPanel({
  currentMember,
  members,
  categories,
  refresh
}) {
  const panel =
    document.querySelector('#adminPanel')

  if (
    !panel ||
    currentMember.role !== 'admin'
  ) {
    return
  }

  panel.hidden = false
  panel.innerHTML = `
    <details
      id="adminPanelDetails"
      class="admin-disclosure"
      ${isAdminPanelOpen ? 'open' : ''}
    >
      <summary class="admin-summary">
        <span class="admin-summary-title">
          관리자 설정
        </span>
        <span class="admin-summary-hint">
          멤버·카테고리 관리
        </span>
      </summary>

      <div class="admin-content">
        <p class="admin-description">
          사용 중지를 해도 기존 연습 기록은 삭제되지 않습니다.
          입력 목록과 차트 항목에서만 숨겨집니다.
        </p>

        <div class="admin-grid">
          <section class="admin-card">
            <h3>멤버 관리</h3>

            <form
              id="addMemberForm"
              class="admin-form"
            >
              <div class="form-group">
                <label for="adminMemberName">
                  멤버 이름
                </label>

                <input
                  id="adminMemberName"
                  name="displayName"
                  maxlength="100"
                  placeholder="예: 김기타"
                  required
                >
              </div>

              <div class="form-group">
                <label for="adminMemberPart">
                  파트
                </label>

                <input
                  id="adminMemberPart"
                  name="part"
                  maxlength="100"
                  placeholder="예: 기타"
                  required
                >
              </div>

              <button
                class="admin-add-button"
                type="submit"
              >
                멤버 추가
              </button>
            </form>

            <div
              id="adminMemberList"
              class="admin-list"
            ></div>
          </section>

          <section class="admin-card">
            <h3>카테고리 관리</h3>

            <form
              id="addCategoryForm"
              class="admin-form"
            >
              <div class="form-group">
                <label for="adminCategoryName">
                  카테고리 이름
                </label>

                <input
                  id="adminCategoryName"
                  name="categoryName"
                  maxlength="100"
                  placeholder="예: 리듬 연습"
                  required
                >
              </div>

              <div class="form-group">
                <label for="adminCategoryColor">
                  표시 색상
                </label>

                <input
                  id="adminCategoryColor"
                  name="categoryColor"
                  type="color"
                  value="#3498db"
                  required
                >
              </div>

              <button
                class="admin-add-button"
                type="submit"
              >
                카테고리 추가
              </button>
            </form>

            <div
              id="adminCategoryList"
              class="admin-list"
            ></div>
          </section>
        </div>
      </div>
    </details>
  `

  const details = panel.querySelector(
    '#adminPanelDetails'
  )

  details.addEventListener('toggle', () => {
    isAdminPanelOpen = details.open
  })

  renderMemberList(
    document.querySelector('#adminMemberList'),
    members,
    currentMember,
    refresh
  )

  renderCategoryList(
    document.querySelector('#adminCategoryList'),
    categories,
    refresh
  )

  document
    .querySelector('#addMemberForm')
    .addEventListener('submit', (event) => {
      void handleAddMember(
        event,
        members,
        refresh
      )
    })

  document
    .querySelector('#addCategoryForm')
    .addEventListener('submit', (event) => {
      void handleAddCategory(
        event,
        categories,
        refresh
      )
    })
}
