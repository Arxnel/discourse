import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { cancel } from "@ember/runloop";
import { service } from "@ember/service";
import { htmlSafe } from "@ember/template";
import { isBlank, isPresent } from "@ember/utils";
import { ajax } from "discourse/lib/ajax";
import { extractError } from "discourse/lib/ajax-error";
import discourseDebounce from "discourse/lib/debounce";
import { escapeExpression } from "discourse/lib/utilities";
import Category from "discourse/models/category";
import I18n, { i18n } from "discourse-i18n";

const DEFAULT_HINT = htmlSafe(
  i18n("chat.create_channel.choose_category.default_hint", {
    link: "/categories",
    category: "category",
  })
);

export default class ChatModalCreateChannel extends Component {
  @service chat;
  @service dialog;
  @service chatChannelsManager;
  @service chatApi;
  @service router;
  @service currentUser;
  @service siteSettings;
  @service site;

  @tracked flash;
  @tracked name;
  @tracked category;
  @tracked categoryId;
  @tracked autoGeneratedSlug = "";
  @tracked categoryPermissionsHint;
  @tracked autoJoinWarning = "";
  @tracked loadingPermissionHint = false;

  #generateSlugHandler = null;

  willDestroy() {
    super.willDestroy(...arguments);
    cancel(this.#generateSlugHandler);
  }

  get autoJoinAvailable() {
    return this.siteSettings.max_chat_auto_joined_users > 0;
  }

  get categorySelected() {
    return isPresent(this.category);
  }

  get createDisabled() {
    return !this.categorySelected || isBlank(this.name);
  }

  get categoryName() {
    return this.categorySelected ? escapeExpression(this.category?.name) : null;
  }

  @action
  onShow() {
    this.categoryPermissionsHint = DEFAULT_HINT;
  }

  @action
  onCategoryChange(categoryId) {
    const category = categoryId ? Category.findById(categoryId) : null;
    this.#updatePermissionsHint(category);

    const name = this.name || category?.name || "";
    this.categoryId = categoryId;
    this.category = category;
    this.name = name;
    this.#debouncedGenerateSlug(name);
  }

  @action
  onNameChange(name) {
    this.#debouncedGenerateSlug(name);
  }

  @action
  onSave(event) {
    event.preventDefault();

    if (this.createDisabled) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const data = Object.fromEntries(formData.entries());
    data.auto_join_users = data.auto_join_users === "on";
    data.slug ??= this.autoGeneratedSlug;
    data.threading_enabled = data.threading_enabled === "on";

    if (data.auto_join_users) {
      this.dialog.yesNoConfirm({
        message: this.autoJoinWarning,
        didConfirm: () => this.#createChannel(data),
      });
    } else {
      this.#createChannel(data);
    }
  }

  async #createChannel(data) {
    try {
      const channel = await this.chatApi.createChannel(data);

      this.args.closeModal();
      this.chatChannelsManager.follow(channel);
      this.router.transitionTo("chat.channel", ...channel.routeModels);
    } catch (e) {
      this.flash = extractError(e);
    }
  }

  #buildCategorySlug(category) {
    const parent = category.parentCategory;

    if (parent) {
      return `${this.#buildCategorySlug(parent)}/${category.slug}`;
    } else {
      return category.slug;
    }
  }

  #updateAutoJoinConfirmWarning(category, catPermissions) {
    const allowedGroups = catPermissions.allowed_groups;
    let warning;

    if (catPermissions.private) {
      switch (allowedGroups.length) {
        case 1:
          warning = i18n(
            "chat.create_channel.auto_join_users.warning_1_group",
            {
              count: catPermissions.members_count,
              group: escapeExpression(allowedGroups[0]),
            }
          );
          break;
        case 2:
          warning = i18n(
            "chat.create_channel.auto_join_users.warning_2_groups",
            {
              count: catPermissions.members_count,
              group1: escapeExpression(allowedGroups[0]),
              group2: escapeExpression(allowedGroups[1]),
            }
          );
          break;
        default:
          warning = I18n.messageFormat(
            "chat.create_channel.auto_join_users.warning_multiple_groups_MF",
            {
              groupCount: allowedGroups.length - 1,
              userCount: catPermissions.members_count,
              groupName: escapeExpression(allowedGroups[0]),
            }
          );
          break;
      }
    } else {
      warning = i18n(
        "chat.create_channel.auto_join_users.public_category_warning",
        {
          category: escapeExpression(category.name),
        }
      );
    }

    this.autoJoinWarning = warning;
  }

  #updatePermissionsHint(category) {
    if (category) {
      const fullSlug = this.#buildCategorySlug(category);

      this.loadingPermissionHint = true;

      return this.chatApi
        .categoryPermissions(category.id)
        .then((catPermissions) => {
          this.#updateAutoJoinConfirmWarning(category, catPermissions);
          const allowedGroups = catPermissions.allowed_groups;
          const settingLink = `/c/${escapeExpression(fullSlug)}/edit/security`;
          let hint;

          switch (allowedGroups.length) {
            case 1:
              hint = i18n("chat.create_channel.choose_category.hint_1_group", {
                settingLink,
                group: escapeExpression(allowedGroups[0]),
              });
              break;
            case 2:
              hint = i18n("chat.create_channel.choose_category.hint_2_groups", {
                settingLink,
                group1: escapeExpression(allowedGroups[0]),
                group2: escapeExpression(allowedGroups[1]),
              });
              break;
            default:
              hint = i18n(
                "chat.create_channel.choose_category.hint_multiple_groups",
                {
                  settingLink,
                  group: escapeExpression(allowedGroups[0]),
                  count: allowedGroups.length - 1,
                }
              );
              break;
          }

          this.categoryPermissionsHint = htmlSafe(hint);
        })
        .finally(() => {
          this.loadingPermissionHint = false;
        });
    } else {
      this.categoryPermissionsHint = DEFAULT_HINT;
      this.autoJoinWarning = "";
    }
  }

  // intentionally not showing AJAX error for this, we will autogenerate
  // the slug server-side if they leave it blank
  #generateSlug(name) {
    return ajax("/slugs.json", { type: "POST", data: { name } }).then(
      (response) => {
        this.autoGeneratedSlug = response.slug;
      }
    );
  }

  #debouncedGenerateSlug(name) {
    cancel(this.#generateSlugHandler);
    this.autoGeneratedSlug = "";

    if (!name) {
      return;
    }

    this.#generateSlugHandler = discourseDebounce(
      this,
      this.#generateSlug,
      name,
      300
    );
  }
}
