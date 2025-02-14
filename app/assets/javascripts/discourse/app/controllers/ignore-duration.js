import Controller from "@ember/controller";
import I18n from "I18n";
import ModalFunctionality from "discourse/mixins/modal-functionality";
import { popupAjaxError } from "discourse/lib/ajax-error";

export default Controller.extend(ModalFunctionality, {
  loading: false,
  ignoredUntil: null,
  actions: {
    ignore() {
      if (!this.ignoredUntil) {
        this.flash(
          I18n.t("user.user_notifications.ignore_duration_time_frame_required"),
          "error"
        );
        return;
      }
      this.set("loading", true);
      this.model
        .updateNotificationLevel({
          level: "ignored",
          expiringAt: this.ignoredUntil,
        })
        .then(() => {
          this.set("model.ignored", true);
          this.set("model.muted", false);
          if (this.onSuccess) {
            this.onSuccess();
          }
          this.send("closeModal");
        })
        .catch(popupAjaxError)
        .finally(() => this.set("loading", false));
    },
  },
});
